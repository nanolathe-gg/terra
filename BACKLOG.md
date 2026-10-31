# Terrain editor backlog for outside agents

This is the work list for agents other than the Claude session that owns
the editor (Codex, OpenCode models). Read the ground rules, then do only
the card you were given. The editor is an experimental prototype with no
tests and no Go gates. It lives in its own repository,
`github.com/nanolathe-gg/terraform` (checkout `~/src/terraform`); cards
before H ran in Nanolathe's `tools/map-editor/`, which is why their notes
name those paths.

The visual review behind the cards is Codex's of 2026-10-27:
`/Users/daniel/.codex/visualizations/2026/10/27/01a17fc7-8a8a-72c1-9e20-57d656f2087d/terrain-editor-review/`
(`index.html`, `review.txt`, `code-review/review.txt`, per-world images).
Its pictures predate the 2026-10-27 merge of the five reproduction
branches and the projection fix below, so re-render before judging.

## Ground rules (every card)

1. **Worktree.** Branch from terraform's `main`, and never edit another
   worktree:

   ```
   cd /Users/daniel/src/terraform
   git worktree add ../terraform-wt-<card> -b <card> main
   ```

2. **Your own server, browser port and assets root** (table below). Link the
   saved catalogues once, then serve every world (a missing world silently
   renders as Green, so never pass `--biomes`). Worlds need nothing from the
   root; `$R/assets-*` is only the measuring source of `measure/`, read-only:

   ```
   R=/private/tmp/nanolathe-map-editor
   mkdir -p $R/agent-<card> && ln -s $R/features $R/map-catalog.json $R/agent-<card>/
   cd ../terraform-wt-<card>
   /Users/daniel/src/terraform/.venv/bin/python sculpt.py \
     --port <server> --assets-root $R/agent-<card> --prepared \
     --export-tool $R/map-export --feature-tool $R/bin/map-features \
     > $R/agent-<card>/server.log 2>&1 &
   ```

   `--prepared` is required since 2026-10-29: macOS removed the retail
   sources that full preparation reads from `/private/tmp`. The server
   loads each world's saved `config.json` and takes the knobs from
   `sculpt.py`. A change to material preparation (the `sculpt_*.py`
   material builders) cannot be tried; report it if a card needs one.

   Restart your server after editing `sculpt.py` or any `sculpt_*.py`.
   Ports 8766-8812 belong to other sessions, and 8801 is the owner's: never
   use them and never stop a process you did not start. The system
   `python3` has no numpy; use the venv above. It lives in the main
   checkout (`python3.13 -m venv .venv`, then `.venv/bin/pip install -r
   requirements.txt`), not under `/private/tmp`: macOS deletes files there
   that have not changed for three days.

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
   | E1 | 8841 | 9641 | `$R/agent-E1/out` | `--worlds green,archipelago,red` |
   | E4 | 8842 | 9642 | `$R/agent-E4/out` | `--worlds lava` |
   | E5 | 8843 | 9643 | `$R/agent-E5/out` | `--worlds ice` |
   | E2 | 8844 | 9644 | `$R/agent-E2/out` | `--worlds crystal` |
   | E3 | 8845 | 9645 | `$R/agent-E3/out` | `--worlds green,red,desert` |
   | E6 | 8846 | 9646 | `$R/agent-E6/out` | `--worlds moon,ice` |
   | E7 | 8847 | 9647 | `$R/agent-E7/out` | `--worlds crystal` |
   | E8 | 8848 | 9648 | `$R/agent-E8/out` | `--worlds desert` |
   | F1 | 8849 | 9649 | `$R/agent-F1/out` | `--worlds zhon` |
   | E9 | 8850 | 9650 | `$R/agent-E9/out` | `--worlds green` |
   | E10 | 8851 | 9651 | `$R/agent-E10/out` | `--worlds lava` |
   | E11 | 8852 | 9652 | `$R/agent-E11/out` | `--worlds green,archipelago,red` |
   | G1 | 8853 | 9653 | `$R/agent-G1/out` | `--worlds green,archipelago,red` |
   | G2 | 8854 | 9654 | `$R/agent-G2/out` | `--worlds green,red,desert` |
   | G3 | 8855 | 9655 | `$R/agent-G3/out` | `--worlds archipelago` |
   | G4 | 8856 | 9656 | `$R/agent-G4/out` | `--worlds desert` |
   | G5 | 8857 | 9657 | `$R/agent-G5/out` | `--worlds lava` |
   | G6 | 8858 | 9658 | `$R/agent-G6/out` | `--worlds ice` |
   | G7 | 8859 | 9659 | `$R/agent-G7/out` | `--worlds crystal` |
   | G8 | 8860 | 9660 | `$R/agent-G8/out` | `--worlds moon` |
   | H1 | 8861 | 9661 | `$R/agent-H1/out` | `--worlds green` |
   | H2 | 8862 | 9662 | `$R/agent-H2/out` | `--worlds green` |
   | H3 | 8863 | 9663 | `$R/agent-H3/out` | `--worlds green` |
   | H4 | 8864 | 9664 | `$R/agent-H4/out` | `--worlds green` |
   | H5 | 8865 | 9665 | `$R/agent-H5/out` | `--worlds green` |
   | H4b | 8866 | 9666 | `$R/agent-H4b/out` | `--worlds green` |
   | H7 | 8867 | 9667 | `$R/agent-H7/out` | `--worlds none` |
   | H6 | 8868 | 9668 | `$R/agent-H6/out` | `--worlds none`, then `green` |
   | H6b | 8869 | 9669 | `$R/agent-H6b/out` | `--worlds none` |
   | H7b | 8870 | 9670 | `$R/agent-H7b/out` | `--worlds none` |
   | H5b | 8871 | 9671 | `$R/agent-H5b/out` | `--worlds none` |
   | H6c | 8872 | 9672 | `$R/agent-H6c/out` | `--worlds none` |
   | H8 | 8873 | 9673 | `$R/agent-H8/out` | `--worlds red,desert,archipelago,moon,zhon,lava,crystal,ice` |
   | H9 | 8874 | 9674 | `$R/agent-H9/out` | `--worlds none` |
   | H8b | 8875 | 9675 | `$R/agent-H8b/out` | `--worlds red,desert,archipelago,moon,zhon,lava,crystal,ice` |
   | H10 | 8876 | 9676 | `$R/agent-H10/out` | `--worlds lava,crystal,ice` |
   | H12 | 8877 | 9677 | `$R/agent-H12/out` | the same look as `merge-h10` |

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
   PY=/Users/daniel/src/terraform/.venv/bin/python
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

   **From H8 on, gate by feature, not by world** (TERRAIN_ENGINE decision
   14). A new knob belongs to a feature and is shared by every world that
   uses it; a world turns it on in its preset. Reuse a feature's knob
   before adding one, and never name a knob, uniform or function after a
   world. Engine uniforms go in `engine-common.wgsl`.

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
   test harnesses. Do not commit to `main`; the owner merges.

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
    `main` yourself.

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
The exported map must load in Nanolathe; that is the target. The owner
will try retail `TotalA.exe` by hand later, so keep the files canonical
and warn where a map exceeds what retail is known to load (phase 4), but
do not limit the editor to retail.

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
  - Generalise the canvas to non-square sizes up to 4x4 units (about
    2,100 px a side). Today's 1024-px canvas is only 2x2. Larger maps are
    phase 3.
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
- **Shape of the export.** Build it as a loop over chunks from the
  start, even though a 4x4 map fits in one; phase 3 streams that loop.
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
- **Ordinary hardware.** The editor must run on ordinary machines, not
  only this one. Treat an integrated GPU and 8 GB of RAM as the floor.
  - Request the WebGPU device with default limits; never raise them.
    Read the limits the adapter really has and size chunks from them.
  - Add memory budgets as knobs: GPU memory for terrain (default 512 MB)
    and the page's JS heap (default 1 GB). Count every texture and
    buffer the editor holds against them.
  - Show that it still works under a low budget (128 MB of GPU memory),
    re-baking more often.
- **While editing, render only the visible slice.**
  - Bake only the chunks that meet the viewport, plus a margin of one
    chunk. Keep them in a least-recently-used cache within the GPU
    budget, and drop the rest.
  - A stroke marks the chunks it touches as dirty. Visible dirty chunks
    re-bake at once; the others re-bake when they scroll into view.
  - The overview and the minimap never bake full-resolution chunks.
    Draw them from a coarse preview, either heights with a per-world
    colour ramp or a low-resolution bake.
  - Keep field planes (heights, masks and the rest) per chunk, allocated
    only where something has been drawn; an untouched chunk is the
    world's base. A chunk's fields can be dropped and recomputed from the
    stroke graph by regional replay.
- **Export: a chunked bake, streamed.**
  - Bake chunk by chunk, row by row. Quantise each chunk to palette
    indices, cut it into tiles, and add them to the unique-tile set at
    once.
  - Never hold the whole map image: at 40x40 units it is about 1.7 GB of
    RGBA.
  - In memory, hold only tile hashes, the tile index map and the
    attribute map. Spill unique tile bytes to a temporary file when they
    pass a budget. Use `$R/agent-D/tmp/` while testing; the tool itself
    uses the OS temporary directory.
  - Chunks go from the browser to the server as they finish, and the Go
    tool assembles the TNT, OTA and HPI from the temporary files.
  - Export can be cancelled and shows progress. A cancelled or crashed
    export leaves nothing partial in the exports folder. Delete
    temporary files by exact name, never with `rm -rf`.
- **The hard part.**
  - The renderer bakes the whole canvas into textures sized `this.size`
    square, so it must bake in chunks instead. Each chunk needs an apron
    wide enough for every neighbourhood pass: normals, blurs, shadows and
    relief.
  - The apron must also cover the projection. Ground 255 high draws up
    to 128 px north of its cell, so a chunk needs the rows south of it.
  - Shapes already replay per region; keep regional replay exact
    (`sculptDebug.replayAll()` mismatch 0).
  - The editor already uses all 16 sampled textures, so chunking must
    not add one.
- **Document.** Save on the server: the stroke graph, sparse painted
  mask chunks, features, starts and OTA settings.
  - Save incrementally, writing only the chunks that changed, not the
    whole map as one blob.
  - Saving and reloading gives the same map.
- **Exactness tests.**
  - The existing 1024-px canvas baked as 2x2 chunks must be
    pixel-identical to the whole bake.
  - A map exported under the 128 MB budget, which forces evictions and
    re-bakes, must give a `.tnt` byte-identical to one exported under the
    default budget.
  - The guard must hold.
- **Measure,** at 16x16 and 40x40 units, under the default and the low
  budget, and put a table in NOTES.md:
  - peak JS heap;
  - GPU memory the editor holds;
  - server memory (RSS);
  - peak temporary disk use;
  - stroke latency on screen and frame time while scrolling;
  - full export time.
- **Out of scope.** Do not start worker-based multi-core replay (see
  "After the cards"), but leave the shape engine callable per chunk so
  that it can come later.
- If this phase fails its exactness tests after two rounds, stop and
  report. The owner will reassign it.

**Phases 1-2 done (merged 14777aa23 and ebb4cdb56).**
- Export is full-detail: the classic shot matches the exported image
  pixel for pixel. The in-game darkening was the engine's gamma 8, which
  is a display setting, not the art.
- Heights reach the shaders shifted by the sea level, so every shader
  works at a sea level of 0.
- Default sea levels per world: Green 75, Red 48, Archipelago 84, Lunar
  1, Lava 23, Desert 0, Crystal 65, Ice 55.
- Features, tree fills, deposits, starts and OTA settings are exported.
- Map mode needs `$R/map-export` and `$R/bin/map-features`, built from
  `tools/map-editor/export` and `/features`. Without them the page says
  only "Could not read map defaults from the installed content".
- With E1-E5 merged, map mode renders lava-1, ice-1 and green-3 like
  their windows, with replay mismatch 0.

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

- **Budget.** A knob defaulting to 6,000 tiles; show the count live in
  the export panel. The format's hard limit is 65,535 (a `u16` index).
  - A retail-safe check warns above 11,500 tiles, the most retail is
    known to load, or above 1,280 cells a side. It warns but does not
    refuse.
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

## Cards E: round 7, from the owner's visual feedback

The owner reviewed the round 6 report
(`https://claude.ai/artifact/1csdAAiBxjNVuCwPBW2d95`, sheets in
`$R/report-r6/`) and wrote the feedback quoted in each card. **The quotes
are the spec.** Judge every change against the retail windows they name,
and against all three windows of the world (rule 5). Wherever the owner
says "keep the ability, change the default", keep the current look
reachable as a knob value. Do not delete it.

Cards run in two waves:

- **Wave 1:** E1, E4 and E5, plus E2 and E3 once the owner agrees their
  approach.
- **Wave 2:** E6 to E11, after E2 and E3 have merged. Wave 2 needs
  shine and layered rock to exist. F1 runs alongside. E10 and E11 carry
  the owner's feedback on the round 7 report
  (`https://claude.ai/artifact/2Vq3zgWq7PjyKE9aYdf13J`), quoted in each
  card.

Wave 2 shares several pieces of code, so each has one owner:

- **E2's shine** (`shineTerm` and its helpers in `sculpt-frag.wgsl`)
  belongs to E6. Other cards set its knobs. A card that needs more
  from the model adds a gated term in its own function and records the
  need in NOTES.md.
- **E3's rock structure** (`bedRelief`, `jointField`, `jointPresent` and
  the crack functions in `relief-bake.wgsl`) belongs to E9. E8 uses the
  existing rock knobs and puts any new Desert shading in its own
  functions.
- **Desert's strata colours** (the `u.strata` block in
  `sculpt-frag.wgsl`) belong to E8.
- **E1's shallow-water shading** (the lit bed, the edge hardness and
  Red's two modes) belongs to E11. F1 draws its sediment tint and streaks
  in its own function, called from the water path.
- **E4's coast pass, shore layers and fingers** belong to E10.

Two conventions keep seven branches mergeable:

- **Mask planes.** `MASK_KEYS` in `sculpt.js` has 14 planes today.
  Plane k is layer k >> 2 and channel k & 3, so planes are numbered by
  their position in the list. A card that needs planes takes only its
  own range below. Pad `MASK_KEYS` up to the start of the range with
  placeholder keys named `free<k>`, and size the mask texture array
  (`sculpt-renderer.js`) to the highest layer used. At merge the owner
  replaces each placeholder with its card's key.

  | Card | Planes | Layer |
  | --- | --- | --- |
  | E11 | 14-15 | 3 (b, a) |
  | E10 | 16-19 | 4 |
  | F1 | 20-27 | 5-6 |
  | E9 | 28-31 | 7 |
  | E6 | 32-35 | 8 |
  | E8 | 36-39 | 9 |
  | E7 | 40-43 | 10 |
- **Shared lists.** New entries in `WORLD_KNOBS`, `KNOB_DEFAULTS`,
  `SHAPE_FIELDS`, the `startStroke` card, `strokeParams` and
  `struct Uniforms` go in one contiguous block at the end of the list,
  headed by a comment naming the card (`// E9`). Never interleave them
  with existing entries.

Cross-world rule: overall, the owner said *"We may want to consider PBR
materials or something similar - shinier rock faces, very shiny crystals,
keep the dull matte grass look, etc."* E2 owns that model. No other card
adds its own specular term.

### E1. Water looks, plus Green and Archipelago ground

> **Green:** Base ground is too lumpy compared to retail. It should mostly
> be flat, with select painted areas having extra noise/lumps. Shallow
> water in retail has a hard stop, ours fade gradually. This should be a
> control for artists and the default in green planet should be almost no
> fade. Shallow water texture doesn't match: ours is noise, retail is lit
> terrain with a blue tint.
>
> **Archipelago:** Mountains/hills are too dark. Reddish zone around
> hills/mountains is a bit too wide, too dark, and should fade more
> gradually into the surrounding terrain. Reddish zone around
> hills/mountains must use the circular pattern instead of veins by
> default to match retail. Shallow water needs to be able to have both
> hard and faded edges, as seen in the retail screenshot.
>
> **Red:** Retail shallow water has two modes: 1. cracked lit terrain with
> a purple tint with a hard stop and 2. shallow lakes with the normal
> ground base texture tinted light purple. We don't do either.

- **Edge hardness.** Water has two edges: shore to shallow, and shallow
  to deep.
  - Measure on the retail windows which edges each world hardens. On
    green-1 and green-3 the shallow-to-deep step is a hard line.
  - Make each edge a control: a world default plus a per-stroke option on
    the water tools, so that one map can have both kinds (Archipelago).
  - Green's default is almost no fade.
- **Lit-bed shallow water.** Draw shallow water as the bed under it, in
  its own material and relief, lit by the same light and then tinted.
  This replaces the noise texture. Tint and strength are per world. Keep
  today's noise water as a knob value.
- **Red's two modes,** as a per-stroke choice:
  1. cracked lit terrain, tinted purple, with a hard edge;
  2. a shallow lake: the ground base texture tinted light purple.

  If none of red-1..3 shows a mode, find it in another Red map under
  `$R/retail-red/` and cut a crop with `repro/retail_crop.py`.
- **Green ground.**
  - Set undulation low or off by default.
  - Lumps become paintable: a mask channel (C5's planes; add one if none
    fits). The existing undulation knobs keep working.
  - Keep the ability, change the default.
- **Archipelago.**
  - Make hills lighter.
  - Make the mineral ring narrower and lighter, with a longer fade.
  - Use the circular pattern by default instead of veins.
- **Server and guard:** port 8841, CDP 9641, guard
  `--worlds green,archipelago,red`. Leave Green's rock faces and cracks
  alone; they belong to E3.

**Done (merged a066f2d76).**
- Shallow water is the lit bed under a tint, with a hard shallow-to-deep
  step as a world default, and per-stroke shore, step and look options
  stored in a fourth mask layer.
- Green's step is at depth 40 with no fade; the p99 edge gradient went
  from 6.2 to 7.3 (retail 7.1-7.2).
- Red has two per-stroke modes: a lilac ground lake, or a cracked bed.
- Green's plain is flat by default, with paintable ground lumps.
- Archipelago's hills went from luma 77 to 90 (retail 90-91). The ring
  is narrower and lighter and defaults to nested rings.

**Still open:**
- The Archipelago ring renders as hairy arcs, not retail's smooth
  concentric contours. It needs an outline-following pattern (new tool
  work).
- Archipelago-1's reef bars are pale and boxy: the hard step exposes the
  scene's rectangular strokes.
- The hard-step depth is one value per world.
- Red's cracked mode uses the world's crack network, not retail's
  cobble-sized polygons.

### E2. Shine and roughness (starts when the owner agrees)

- **The model.** Add a specular lobe and micro-normal roughness per
  material inside the existing baked light. This is not a PBR pipeline:
  the output is an 8-bit image under one fixed sun, so what the eye
  reads is the highlight and its grain.
  - "Shiny rough" (ice, lava rock) means strong specular over
    high-frequency normal noise.
  - "Matte" (grass) means no specular.
- **Controls per material:** gloss (highlight strength), sharpness, and
  roughness (normal noise amplitude and scale). Every default must
  reproduce today's output exactly.
- **Judge after the palette stage.** Highlights quantise to whichever
  bright entries the world's palette has. A highlight that looks right in
  RGB can collapse or band after palette pairs and dither, so check by eye
  on the final output, not the pre-palette buffer.
- **Defaults.** Set them for Crystal ("Retail is much shinier") and
  leave every other world off. E6 and E7, and a later shine pass on E4
  and E5, adopt the model.
- **Server and guard:** port 8844, CDP 9644, guard `--worlds crystal`.
  Every other world must match exactly.

**Done (merged 8adee6c6e).**
- The model is a Blinn lobe over a micro-roughened normal per material.
  Its knobs are `shine<Material>`, `...Sharp`, `...Rough`, `...Scale`,
  `shineStretch` and `shineWhite`. It applies after the highlight cap and
  before the palette stage.
- Crystal gloss is .3-.4 with roughness 1 at 8 px. The p99.8 luma of the
  mounds went from 155 to 213 (retail 164-197). The other 24 windows are
  exact.
- The adopter how-to is in `$R/agent-E2/NOTES.md`.

**Still open, for E6 and E7:**
- Lava's banks take the ground's colour, so rock and slope gloss do
  nothing there. Ground gloss at roughness 0 and sharpness about 20 puts
  glints on sun-facing banks, but Lava needs a slope gate.
- On near-white Ice the additive lobe saturates, so Ice reads rough, not
  shiny.
- Crystal's mean luma is still above retail.
- Grain axis and stretch are global, not per material.
- Nothing was tried with palette pairs.

### E3. Layered rock: relief, not ink (starts when the owner agrees)

> **Green:** Retail cracks provide relief and have highlights, ours are
> primarily dark lines and tend to be too dark. Rock faces are a bit too
> dark. Retails large green-2 rock face reads like coherent sedimentary
> horizontal layers with lines your eye can follow, then scratched
> vertically at a slight angle (the deep cracks running north-south down
> the whole face). Ours reads like scattered gravel.
>
> **Red:** Slope cracks are a bit dark and rough, retail is a little
> lighter and has smaller fine detail and fades into the base texture
> more naturally (red-3).
>
> **Painted Desert:** Retail tall mountains have more shading, but
> continue the strata pattern, ours just turn ugly gray.

**Relief, not ink.** Strata and joints are micro-relief lit by the sun:
a highlight on each ledge lip and shadow beneath it. They are not dark
lines. Do not tune `crackDark` to fix this.

- **Rock structure model:**
  - **Layers:** spacing, thickness variation, tilt (dip and direction),
    and ledge step strength.
  - **Joints:** spacing, angle, depth and continuity. Green-2's
    north-south scratches run the whole face.
  - **Scatter:** the end of the dial that gives today's gravel look, so
    the current look remains reachable.
- **Crack style.** Give cracks a choice between "relief" (lit groove
  with a lit lip) and today's "ink".
- **Defaults:**
  - Green rock faces get lighter, with layers and joints on green-2.
  - Red slope cracks get lighter and finer, and fade into the base.
  - Desert's tall mountains continue the strata, with more shading and
    no gray.
- **Server and guard:** port 8845, CDP 9645, guard
  `--worlds green,red,desert`. E1 also changes Green and Red; your knobs
  differ from E1's, and the owner reconciles the `WORLD_KNOBS` entries at
  merge.

**Done (merged 9f173e6c1).**
- Beds and joints are lit micro-relief in the bake. `rockOrder` runs
  from 0 (scatter) to 1 (structure). The other knobs are `bed*`,
  `joint*`, `crackStyle` and `rockFrom`.
- Beds are level on the screen. Retail green-2 rows are 8-12 px apart
  whatever the slope.
- Green-2's thin-line direction shares (vertical | horizontal) went from
  .47 | .13 to .37 | .24 (retail .29 | .27). Red cracks are finer and
  lighter. Desert strata continue on the buttes.

**Still open:**
- **Owner's question, answered:** the rock faces were "too dark", but
  their mean luma already matched or exceeded retail's. Retail has more
  contrast (luma sd 27 against our 19-20, with more deep darks and twice
  our share above 90). The owner's answer is card E9.
- **Rule 8** was exceeded on Green, with about 19 cycles.
- **Desert (E8):** the buttes are smooth cones with no black shadow side,
  and the strata lines are 3-4 px apart against retail's 10-18.
- **Red-3:** its dark chunks come from the authored terrain.
- The adopter how-to is in `$R/agent-E3/NOTES.md`.

### E4. Lava shore layers, fingers and rock

> Retail has many layers in the terrain near lava (lava-1 contour layers,
> lava-2 circular pattern layers). Retail layers are flat and wide, going
> inland a good distance and showing each layer clearly and lit naturally.
> We have slight contour layers but it's not nearly enough and the wrong
> style (dark bands). We must fix this. Lava fingers in retail are thin and
> low. The edges of the shore are not deeply shaded/shadowed. Ours are fat
> little triangles with too much shadow that break up and combine
> awkwardly. This needs another pass. Retail mountains/hills are shiny
> rough rock. Ours are dull rock with black contour lines. That's not
> correct.

- **Shore terraces are height geometry.** Wide flat layers step down to
  the lava and reach well inland. Each one is lit by the sun: a lit top
  and a shaded riser.
  - **Two styles:**
    - **Contour:** layers follow the shoreline (lava-1).
    - **Circular:** overlapping round layers (lava-2).
  - **Controls:** layer count, layer width (inland reach), riser height,
    irregularity and style.
  - Rule 6 applies: do not draw lines to fake layers. The B3 band knobs
    (`bandRelief`, `bandLine`, ...) stay reachable.
- **Fingers.**
  - Make them thin and low, with soft shading and no deep shadow.
  - The owner has approved last round's open decision: fingers now apply
    to the joined coastline, so overlapping water strokes no longer flood
    each other into wedges (Kill the Middle, lava-1).
- **Rock.** Remove the black contour lines from mountains and hills, and
  shape rough rock relief. Shine comes from E2 later: do not add a
  specular term.
- **Server and guard:** port 8842, CDP 9642, guard `--worlds lava`.

### E5. Ice shore and bergs

> Our shoreline is improved but still not close to retail. We have a
> polygonal ice shelf with distinct shapes and water in between. Retail
> has ice crystals with visible straight lines naturally distributed
> throughout that get thinner toward deep water. Ours is an interesting
> effect artists might want, but it doesn't match retail at all. [...]
> Our weird crystal for ice-2, ice-3 makes no sense. It's not even close.

- **Shore.**
  - The new default is ice crystals with visible straight lines,
    distributed through the shore zone and thinning toward deep water
    (ice-1).
  - Keep the plate shelf (`shorePlates`) as an option. Keep the
    ability, change the default.
- **Bergs (ice-2).**
  - A berg is an irregular rough block: an uneven outline, broken facets,
    and rough, strongly lit faces with no clean bevel.
  - The scene's pentagon is a placeholder plateau. If the tools cannot
    make a berg, build the tool, for example a berg option on the plateau
    with facet count, outline jitter, face roughness and top tilt. Then
    update the scene in its own commit (rule 6).
- **Box hollow (ice-3).** A square hollow with dark, rough inner faces
  and a rough rim. Read `layout.png` for the relief.
- **Out of scope:** the material of Ice mountains. E6 owns it.
- **Server and guard:** port 8843, CDP 9643, guard `--worlds ice`.

**E4 done (merged f3a0fb261).**
- Shore layers are cut as height: contour style on lava-1, circular on
  lava-2. Lava-1's median shore band went from 64 to 113 px (retail 107).
- Fingers lie on the joined coast as irregular tapered tongues and
  tendrils, with no flooded wedges.
- Lava rock has no black ink.
- The coast pass costs 17-33 ms per water stroke, and the old 3.8e-6
  replay mismatch is gone.

**Still open (for E6):**
- Lava-1's fingers are too sparse. The levers are `thumbAt`'s site
  probability, the length law and the root width `h0`.
- The circular layers are faint.
- Lava-1's sun-facing north bank shows no layer lines; retail's are dark
  at every facing.
- Lava-3's tall hill is still a cone.

**E5 done (merged a5ac69aa7).**
- Bergs are a Crystals-brush form: ice-2's dry overlap went from .455 to
  .815.
- Ice-3 is the raised block the retail heights show: overlap went from
  .213 to .787.
- `shadeBlue` keeps shaded ice blue.
- Frost crystals are Ice's default shore: mostly plain ice, sparse
  needles, blue gaps toward deep water, and no grey wet band
  (`frostWet`).

**Still open (for E6):**
- Retail's frost band has more fine lines and about 4x the inland blue
  gaps.
- Retail has a darker submerged shelf offshore.
- The berg's lit faces are about 50 per channel darker than retail's and
  lack its vertical crease.
- Ice-3's faces are speckled where retail's are smooth dark slate.

### E6. Moon and Ice mountains (wave 2, after E2 and E3)

> **Moon:** Retail hills are rough, pockmarked, and relatively uniform in
> texture. Ours have smooth tops and cracks on the side, which doesn't
> match at all. Craters are generally good, but should have the same
> uniform rough texture as hills on the sloped sides, and retail has no
> cracks. Retail lunar surface is a bit shiny.
>
> **Ice:** Our hills/mountains look good but don't match retail. Keep the
> ability, change the default: retail mountains are two types: 1. weird
> straight-line crystal dark slopes with crystaline tops (ice-1) and the
> more common one is monotone very rough shiny ice lit strongly.

- Use E2's model for every shine, and E3's structure where it helps.
- Ice's mountain style becomes a choice. The default is the common
  monotone, rough, shiny ice; the ice-1 crystal style and today's look
  remain choices.
- E6 owns E2's shine model. E2 left Ice open: on near-white ice the
  additive lobe saturates, so Ice reads rough, not shiny.
- **Server and guard:** port 8846, CDP 9646, guard `--worlds moon,ice`.
  Lava's rock shine moved to E10.

Order of work: Moon, then Ice mountains. Then take E5's open items above,
most visible first: the frost band's fine lines and blue gaps, the berg's
lit faces and crease, the submerged shelf, then ice-3's speckle. Rule 8
applies to each, and whatever is left stays open.

**Done (merged eaf4c141f; EXPERIMENTS rows 104-108).**
- **Moon:** hills and crater walls are one pitted surface with no cracks
  (`pockmark`, `pockSize`), with a trace of sheen on raised ground only
  (`shineGate` in the model). The old look is the Moon variant
  `cracked`.
- **Ice mountains:** the default is monotone, very rough slate
  (`iceSlate`, `mineralDetail`; renamed from E6's `rockDetail` at merge,
  because E9 uses that name). The variant `crystal` (`iceCrystal`,
  `iceCrest`) is ice-1's type, and ice-1 uses it. `snow` is the earlier
  mountain.
- **Frost band:** finer needles and smaller melt pockets. Its luma and
  s.d. now match retail's.
- Ice-3's speckle is gone: its fine-detail energy is 12.7 against
  retail's 13.0.
- `shineHeadroom` is in the model but unused. It did not stop the
  saturation on ice-3 and only darkened it.

**Still open:**
- **Moon:** retail's fine diagonal streaks on lit faces and its folded
  ridges are missing. The pits read as a lattice, and the tops are
  lighter than retail's.
- **Ice crystal style:** the strokes are thinner and sparser than
  retail's hatching, and the shaded east side takes none.
- **Frost band:** the blue gaps read as dotted pits, and there is no
  ragged edge or Y-shaped seams.
- **Berg:** the lit faces are darker than retail's, and the crease is
  missing.
- **Submerged shelf:** not built. Retail's water there shifts violet at
  equal luma, which is E11's water path.

### E7. Crystal (wave 2, after E2)

> Retail is much shinier. Retail crystals all have size variation and some
> hill smoothness between some crystals. All shallow water should be small
> crystals. Craters/indents have crystal-like contours as well. Honestly
> overall this already looks very good.

- **Server and guard:** port 8847, CDP 9647, guard `--worlds crystal`.

**Done (merged aa999ad8d; EXPERIMENTS rows 87-91).**
- Column tops are crumpled facets, with three widths mixed over a mound
  and some smooth hill between them.
- Craters are tiled with crystal facets.
- All shallow water carries small crystal cells.
- The shine is retuned. The mounds' mean luma is now within 3-7 of
  retail's; it was 6-12 above.
- The other 24 windows are exact, and the merged build matches the
  agent's renders exactly.

**Still open:**
- **Facet outlines:** retail outlines every facet in a thin black web.
  Ours keeps thick, dark risers between the larger columns: the 12-34
  luma band covers 37.7% against retail's 33.1% (the lever is
  `crystalStep`).
- **Craters:** they read as rubble. Retail's are shaded faces under that
  thin web.
- **Crystal-3:** the mound is brighter than retail's, which is dark and
  crumpled with few glints.
- **Shallow cells:** they are shading, not bed relief.

### E8. Painted Desert (wave 2, after E3)

> Retail has a gray band near the base (desert-1, desert-3). [...] Retail
> has more bumpy variation near the base of hills, ours are relatively
> smooth. We should have both variations in height and major variations in
> shape at the base.

> **Round 7 report:** painted desert tall buttes are better, but
> desert-2 is still missing them on the cliff face. Those strata layers
> exist in the rock itself so even weathered cliffs should show them.
> Still missing the gray bands that retail has

- The variation at the base is shape: outline and height. Rule 6 applies.
- **Strata run through the rock.** Every cliff face shows the strata,
  weathered or not, including desert-2's. Find what hides them there.
  The first suspect is the strata block in `sculpt-frag.wgsl`:
  - where `painted.x` (painted rock) is 1, it mixes the bed colour
    towards one `rockBed`;
  - `onRaised` is cut by `(1.0 - route)`.

  If desert-2's cliff is painted rock or a routed face, that is where
  its strata vanish.
- **The grey band** near the base (desert-1, desert-3). Measure its
  height range, width and colour on the retail windows.
- E3 left the buttes as smooth cones with no black shadow side, and
  strata 3-4 px apart against retail's 10-18.
- **Server and guard:** port 8848, CDP 9648, guard `--worlds desert`.

**Done (merged a0b77aea7; EXPERIMENTS rows 92-95).**
- desert-2's strata were there, just too thin: under 1 px on a steep
  face. Each zone now has its own bed thickness.
- Feet are ragged and aprons bumpy, cut as height.
- A grey band runs near the base.
- desert-2's buttes are cones with a dark side.

**Still open:**
- The grey band reads as blotches, not retail's streaks along the beds.
- Strata lines are 8 px apart against retail's 14.
- Foot roughness is 55-70% of retail's, and about 30% on desert-2.
- There are no shadows darker than luma 25.
- Retail's rubble halos and pebbles around desert-2's buttes are not
  done.
- E3's bake ledges (spacing 4-6) don't match the new colour beds
  (11-14).

### E9. Green rock faces (wave 2, after E2 and E3)

> **Owner, round 7, asked whether "too dark" meant tone or contrast:**
> I think it feels darker because it didn't have the shiny/specular
> highlights and coherent 3d rock face look with the sedementary lines and
> scratch erosion/weathering lines as coherent 3d. It is still too far off
> retail to be convincing at this point.

The E3 quote above still applies. Green-2 at merge-d2
(`$R/repro-out/merge-d2/green-2/`), retail on the left and ours on the
right, rock band at rows 600-880:

- **Form.** Retail's face is a carved surface. Broad gullies and ribs run
  down it at a slight angle, tens of pixels apart, so whole stripes of the
  face are lit or shaded. Ours has no form at that scale: it is an even
  mid-grey.
- **Detail.** Retail's detail is sharp, angular facets with bright
  white-grey glints on sun-facing edges. Ours is soft, rounded cells in a
  regular cobble or brick pattern.
- **Layers.** Retail's horizontal lines are long and continuous across
  the ribs, and they bend with the face. Ours are the edges of cells.
- **Grass.** Ours has green specks all over the rock. Retail's grass
  stays near the edges of the face.

What to deliver:

- **Coherent 3D form.** Gullies and ribs are relief lit by the sun, with
  a lit wall and a shaded wall. They have spacing, angle, depth and
  length controls. Beds run as continuous ledges across the ribs, each
  with a lit lip and a shadow beneath it.
- **Weathering scratches.** Long, thin grooves run down the face at a
  slight angle, as lit relief. They are not ink.
- **Shine.** Glints on sun-facing facets come from E2's model, through
  knobs on Green's rock material. Grass stays matte.
- **Check the grass on the face.** Find out where the green specks come
  from, and keep grass to the face's edges as retail does.
- Keep the ability, change the default: today's look stays reachable
  through the knobs.
- Judge on all three Green windows (rule 5). Red and Desert also use the
  rock structure, so they must match exactly.
- **Server and guard:** port 8850, CDP 9650, guard `--worlds green`.

**Done (merged 07c8b9fb8; EXPERIMENTS rows 96-99).**
- Green-2's face has leaning gullies and ribs, bending ledges with lit
  lips, scratches, two levels of facets, and glints. Grass stays at the
  edges.
- Its contrast and bright share now match retail's (luma s.d. 26.3
  against 27.2).
- Green-1 and green-3 are neutral.

**Still open:**
- By eye the face reads as neat masonry. Its facets are regular and
  brick-like, with too few black crevices (share under luma 30 is .12
  against .25), and its glints are pin-pricks where retail's cover whole
  facets. The levers are listed in `$R/agent-E9/NOTES.md`: a finer
  third facet level, roughness that varies by region, more varied bed
  spacing, and a darker rock base.
- The face's outline is ragged where retail's grass fringe is soft.
- Retail's hills carry long, thin diagonal black cracks in the moss.
- `shineOutside` is a gate after `shineTerm`. The model needs a painted
  coverage weight (E6).
- Rule 8 was exceeded: about 14 rounds.

### E10. Lava shore layers, fingers and rock shine (wave 2)

> **Round 7 report:** lava-1 shore layers are better, but there may not be
> enough and they need more natural variation like in retail. In lava-2
> it's not good. It should be like many circles cut out from the edge in
> layers like retail has.
>
> lava fingers are improved but should be flatter and their
> amount/size/distribution should probably just be configurable per lava
> area/shoreline with some natural variation with small fingers as the
> default and the ability to crank it up when desired.

E4's quote above ("Retail mountains/hills are shiny rough rock") also
applies.

- **Layers.**
  - Lava-1: more layers, with natural variation in width and outline.
  - Lava-2: the circular style becomes many circles cut out of the
    shore's edge, layer after layer. Each step is a scalloped arc, not a
    contour.
  - Both are height geometry (rule 6).
- **Fingers.**
  - Make them flatter.
  - Amount, size and distribution become per-stroke options on the lava
    water tools (all four places, rule 4), with natural variation along
    the shore.
  - The default is small fingers, and the options can raise them.
- **Rock shine.** Lava's hills and mountains become shiny rough rock,
  using E2's model through knobs.
  - E2 found that Lava's banks take the ground's colour, so they need a
    slope gate. Put the gate in your own gated function. E6 owns
    `shineTerm`.
- E4's open items also belong here: the north bank's layer lines (retail
  shows them dark at every facing) and lava-3's tall hill, which is
  still a cone.
- **Server and guard:** port 8851, CDP 9651, guard `--worlds lava`.

**Done (merged 692da9655, knob renamed 7dc86c9a3; EXPERIMENTS rows
109-112).**
- Lava-1 has 11 uneven layers, and a dark crease at each step's foot
  shows the lines on every bank.
- Lava-2's circular style is round bites cut from the bank, layer after
  layer. Its median band is 57.7 px, as retail's. `layerStyle` 1 is now
  bites; the old stepped mounds are 2.
- Fingers are flat and blunt. Amount, size, distribution and height are
  per-stroke options; the default is small. `repro/demo/lava-fingers-cranked.json`
  shows them turned up.
- Rock shine is gated by slope (`shineSlopeGate`; E6's `shineGate` is a
  different knob).
- Hills can be stacked lobes; lava-3's hill uses them.

**Still open:**
- Lines are cleaner than retail's, and retail's banks are darker.
- Lava-2's bites are too even in size, with outlines that are too black.
- Large fingers have square tips; on curves they become wedges.
- Lava-3's hill is lighter than retail's, with no black far side.
- Changing a shape option leaves Export disabled for over 20 s (card A1's
  defect).

### E11. Shallow water and Archipelago, round 2 (wave 2)

> **Round 7 report:**
> - flat ground: good
> - green-1 shallow water is good, but could use additional variation
>   from the shoreline to make it feel more natural. The shallow water
>   texture is too smooth. green-3 still has blurry parts, matches the
>   shorline too closely (needs variation)
> - archipalego-1 shallow water needs texture from retail
> - archipalego hills are better, but there are some weird black/dark
>   lines around them that aren't present on retail, and retail has more
>   noticeable circle features in the red fringe (maybe this could be
>   configurable?)
> - mars shallow water is much better, however the lake style seemes to
>   have darker dots in retail than the base texture, and red-3 shallow
>   water is too little compared to retail and the cracks are too soft
>   (should be based on land cracking/roughness/slope) and the edge
>   against the deep water seems shaded when retail's is more of a hard
>   cut off with natural variation

"Mars" is Red.

- **Green.**
  - The shallow band's width and outline vary along the shore, rather
    than following the shoreline at a fixed offset. This applies to
    green-1 and green-3 especially.
  - The bed under shallow water carries the ground's texture. It is too
    smooth today.
  - Find and remove green-3's blurry parts.
- **Archipelago.**
  - Archipelago-1's shallow water gets the texture its retail window
    shows.
  - Find where the dark lines around the hills come from and remove
    them.
  - The red fringe gets circle features as a control (count, size,
    contrast). The default matches retail's more noticeable circles. E1
    left the ring as hairy arcs, not smooth contours that follow the
    hill.
- **Red.**
  - The lake mode gets retail's darker dots.
  - Cracked mode takes its crack strength from the land: its cracking,
    roughness and slope. It is too soft today.
  - The shallow-to-deep edge becomes a hard cut-off with natural
    variation, not shading.
  - Red-3 has too little shallow water. If retail's heights show more
    shallow ground, follow them in the scene, in its own commit (rule
    6). Otherwise change the tool.
- **Ownership.** E9 changes Green's rock at the same time. Stay off rock
  faces and E3's code.
- **Server and guard:** port 8852, CDP 9652, guard
  `--worlds green,archipelago,red`.

**Done (merged 34065f41f; EXPERIMENTS rows 100-102).**
- **Green shallows:** the step wanders along the shore. The bed is lit
  by its own relief, which removed green-3's blur, and carries
  mid-scale mottle.
- **Red:** a hard step, a stronger cracked bed and lake dots. Red-3's
  scene follows retail's wider shelf.
- **Archipelago:** the fringe is contour lines that follow each hill,
  the black lines at the hill foot are gone, and reef bars are dappled.

**Still open:**
- Archipelago's lines read as dashes; retail's are finer and smoother.
- Green's per-pixel dark share is twice retail's (`bedMottle` is the
  lever). Red's lake dots are heavier than retail's.
- Red's cracked mode uses the world's crack knobs at a rocky slope. It
  does not yet sample the neighbouring land.
- Green's shallow outline is smoother than retail's notches.

### F1. Flow bake, stage 1: current and colour (after E1 merges)

The spec is `FLOW_BAKE.md`: stage 1 and the owner's decisions. This
stage changes no heights.

- **River tool.** Strokes set the current's direction, strength and
  width.
- **Source tool.** Dabs set a sediment colour and amount.
  - The colour comes from a free picker that suggests colours (for
    example from the world's palette).
  - It remembers colours used before, with the world settings.
- **Bake.**
  - A Bake button runs the bake in a worker over the region of its
    inputs plus a margin, with progress.
  - The result is cached under a hash of what it reads. A stale badge
    appears when an edit changes that hash, and the old result stays on
    screen until the next bake.
  - An option bakes automatically when the editor is idle.
- **Outputs and replay.**
  - Flow direction and speed, and the concentration of up to three
    sediments, are stored as extra layers of the existing mask texture
    array. Add no new binding: the editor is at 16 sampled textures.
  - Save and load keep them.
  - Replay reads the planes: `sculptDebug.replayAll()` mismatch 0 with
    a bake present.
- **Shading.**
  - Water is tinted by sediment concentration.
  - Streaks follow the flow, scaled by speed.
  - Banks are tinted where sediment reaches the shore.
- **Judge on zhon-1..3:** maroon sediment from upstream mixing into teal
  channels, streaks along the current, and red-tinted banks. Add river
  strokes and sources to the three Zhon scenes in their own commit (rule
  6: the scenes follow the retail flow).
- **Server and guard:** port 8849, CDP 9649, guard `--worlds zhon`.
  Scenes without a bake must match exactly.
- Codex's card D phase 3 is adding chunked baking at the same time. Keep
  the planes ordinary mask layers so that phase 3 can treat them like the
  others.

**Done (merged 0ac568579; EXPERIMENTS row 103).**
- River and Source tools: a colour picker suggests the world's colours
  and remembers those used before.
- A worker bake with progress, Cancel, a cache, a stale badge and an
  optional idle bake.
- Planes 20-24 store the flow and three sediment concentrations; mask
  layers went from 4 to 7. Save and load keep them, and replay is exact.
- Without a bake, every scene is unchanged.
- The bake takes 0.9 s per Zhon scene. `FLOW_BAKE.md` has an "As built"
  section, and `$R/agent-F1/NOTES.md` lists what the export must read.

**Still open:**
- The sediment reads as a diffuse brown haze. Retail's plumes are
  strong maroon lanes with clear teal between them and a continuous
  bank band 50-70 px wide. Our streaks are faint.
- A fourth colour silently merges into the nearest of three.
- There is no random-hue source.
- The bake is not chunked (card D phase 3).
- The localStorage autosave may refuse a sketch with a bake.
- The bake reads heights from before its node; move the node to change
  that.

### Zhon: not a card yet

The owner wants to discuss tools first: random-coloured sand deposits,
water flow carrying and mixing them downstream with light sand islands, a
flow direction and strength tool, and rainfall and erosion applied
selectively. Flow and erosion are not local, so any design must bound the
simulation to a painted region plus a margin to keep regional replay
exact. A one-page design comes before any prototype: `FLOW_BAKE.md`. It is
a cached bake step, which the owner accepts being slower to edit.

Round 8 (owner): *"Let's leave the flow bake for now. It's okay but I
think we need to revisit the tool and how we expect artists to use flow
baking in general (I think it can be used on land as well, help control
weathering, sand dunes, etc). Let's leave a TODO and revisit later."* The
TODO is at the end of `FLOW_BAKE.md`. No card.

## Cards G: round 8, from the owner's review of wave 2

The owner reviewed the wave 2 report
(`https://claude.ai/artifact/PL5ESAtZmi5PRVbKAXxTwA`) and wrote the
feedback quoted in each card. **The quotes are the spec.** Renders of
`terrain-editor` at the start of this round are in
`$R/repro-out/r8-quick`; renders from before wave 2's E6 (Moon and Ice)
are in `$R/repro-out/merge-e10`.

Two of the owner's points were settled before the cards (2d7ddf72d). The
Shallow tool now starts in Area mode, which draws shallows anywhere,
through land too. ice-1 uses the Ice variant `snow`, the mountain from
before E6, with E6's finer frost shelf.

**Card D lands first.** The G cards branch from `terrain-editor` after
card D phase 3 (region-by-region replay for large maps) has merged.
Shader and knob changes work as before. A change to replay or brush code
must keep regional replay exact. That covers the node functions,
`startStroke` geometry, the coast pass, crystal facets, hill lobes and
craters:

- If the change reads ground beyond its stroke's own rectangle, add that
  reach to `regionalReadApron` in `sculpt.js`.
- Run `repro/regional.mjs` on your world's three scenes. It replays the
  whole map and again as 2x2 regions and compares every field plane. It
  must report no mismatch. Record the output in NOTES.md.
- A shader takes positions only from the inputs today's shading already
  uses (the world pixel position and the baked textures), never from the
  canvas size, because card D renders large maps in chunks through the
  same shaders.

No G card takes a mask plane without asking first, because under card D
every plane costs memory in every chunk.

Each card owns its piece of shared code. Other cards only set its knobs:

| Card | Owns | New knob names start with |
| --- | --- | --- |
| G1 | E11's shallow-water shading and edges | `shoal` |
| G2 | E9's rock structure (`bedRelief`, `jointField`, the crack functions in `relief-bake.wgsl`) | `cliff` |
| G3 | E11's Archipelago rings | `ring` |
| G4 | the Desert strata colour block (`u.strata`) | `desert` |
| G5 | E10's Lava coast and rock shading | `lava` |
| G6 | E6's Ice mountains and E5's frost band | `ice` |
| G7 | E7's crystal shading | `crystal` |
| G8 | E6's Moon surface and E2's shine model (`shineTerm`) | `moon` |

Prefixes keep two branches from choosing the same name (wave 2 merged two
`shineGate`s and two `rockDetail`s). Shared lists still grow in one block
per card, headed by a comment naming it (`// G4`).

**Merged.** All eight cards are on `terrain-editor` (last merge
4445941c5). Renders of the merged tree are in `$R/repro-out/merge-g5`.
On the merged tree:

- `repro/regional.mjs` reports no mismatch on all 53 scenes and demos.
- The large-map export check (lava-1 and green-2 on 4x4 maps) gives the
  same `.tnt` bytes and the same indexed image at 128 and 512 MiB of GPU
  budget. It ran with `heapMB=1536` because of G5's heap overflow (see
  G5's "Still open").

### G1. Shallow water, round 3

> **Green:** Shallow water: overall better, however the texture is wrong.
> It reads as noise while retail reads as lit bumpy terrain under the
> water with a blue tint, rougher than the grass above it. The hard edge
> can be more irregular on a small pixel scale like retail.
>
> **Archipelago:** Shallow water: better control over edges is good (it
> should be the artist's choice) but the texture is all wrong. Retail
> seems to prefer a look of lit bumps over random noise, and so it feels
> like there is some directionality to it and ours feels flat. Note: the
> default should still have a small blur on the edge.
>
> **Red:** Shallow water: lakes are much improved, but not quite the same
> texture. Maybe analyze red-2 retail for that specific look. For red-3
> cracked shallows it is much improved but the transition from shallow to
> deep water needs a pixel-ragged edge, right now it is too smooth.

- Green, Red and Archipelago already default to the lit bed (`bedLit=1`,
  `bedRelief=1` in `sculpt.py`), and the owner still reads noise. So the
  work is the bed itself: lumps big enough to have a lit side and a shaded
  side under the same sun, rougher than the grass above the waterline,
  under a blue tint. Measure lump size and the lit/shade split on the
  retail windows at 2x before changing anything.
- **Edges.** Green's hard shore edge gets 1-3 px steps like retail's.
  Archipelago's default shore edge gets a small blur; Hard and Faded stay
  as choices per stroke.
- **Red.** Describe red-2's lake bed at 2x first. On red-3 the cracked
  bed (`waterBed` 3) loses the ragged shallow-to-deep stairs that Red's
  `deepEdge=1` should give; find out why.
- **Server and guard:** port 8853, CDP 9653, guard
  `--worlds green,archipelago,red`.

**Done (merged 2b7371c21; EXPERIMENTS rows 122-123).**
- The shallow bed carries lit bumps (`shoalBump`, `shoalBumpPx`) with the
  palette dither off on it (`shoalDither` 0). green-1's clump sizes are now
  near retail's.
- Edges: `shoalRag` notches the shallow-to-deep step whatever the bed's
  slope; `shoalStairs` gives Green's hard waterline 1-3 px runs;
  `shoalShoreSoft` blurs Archipelago's world waterline by 4 px.
- `shoalGrain` lets Red's pink grain show through the lake tint.

**Still open:**
- Green's bumps are a little larger than retail's, and retail's sparse
  dark flecks are missing.
- Archipelago's depth profile: retail fades over about 25 px; ours keeps a
  mid-blue plateau to 55 px (scene shelf depths and the depth ramp).
- Archipelago's brown wet-sand rim, which retail lacks.
- red-2's larger pink patches; red-3's crack polygons are 28 px against
  retail's 15-20.
- `shoalShoreSoft` overrides `shoalStairs` when both are set.

### G2. Rock faces: finer pieces, strata that follow the slope

> Rock face: good from a distance. I think we are struggling with some of
> the details up close. My eyes read it as a little too shiny, and the
> horizontal bands are too far apart. Maybe same with the vertical bands,
> but retail also has some randomization between the vertical bands that
> just make it look like textured/lit broken up rock. Ours is too smooth
> within the horizontal bands, overall retail just has smaller pieces or
> bumps on those pieces and more irregularity.
>
> Small note on rock face: the horizontal and vertical bands should be
> relative to the slope of the hill or cliff they are on, so if I manually
> paint rock on a flat surface or right side of a hill, it should not have
> the sedimentary bands that were going left-to-right when facing me going
> the same direction, they should follow the hillside. Make sense?

- **Orientation first.** It is structural, and the owner means every world
  with layered rock, not only Green.
  - Bedding (the horizontal bands) runs along the contour of the local
    slope. Joints (the vertical bands) run down the fall line.
  - Find where today's bands take a fixed screen direction.
  - On painted rock with no slope under it, take the direction from the
    slope around it, from heights smoothed at a larger scale. Where there
    is no slope at all, fade the bedding into plain broken rock.
- **Then Green up close,** at 2x against green-1..3:
  - less shine, through the shine knobs (G8 owns the model);
  - beds closer together, measured on retail in px;
  - joints at irregular spacing and offset from bed to bed;
  - smaller lit pieces and bumps within each bed.
- **Server and guard:** port 8854, CDP 9654. The guard is
  `--worlds green,red,desert`, the worlds with E3's layered rock.
  Orientation may move Red and Desert. Show every moved window in the
  review sheets.

**Done (merged ac993d8a9; EXPERIMENTS rows 116-118).**
- `cliffFollow` (Green, Red, Desert): beds are contours of the smoothed
  ground; joints, gullies, scratches and facets run down its fall line, per
  90-px patch. Level painted rock takes the fall line of the slope around
  it, or fades to plain broken rock. `repro/demo/cliff-orient.json` shows
  four walls and two level patches.
- Green up close: less shine, beds 5 units apart, joints 34 px and offset
  from bed to bed (`cliffStagger`), smaller pieces (`cliffFine`).
- The chunk renderer's bake reach covers the frame's rings and patch seeds
  (about 190 px with Green's values).

**Still open:**
- The chunk reach is derived, not rendered in chunks.
- Contrast: retail's crevices are denser and darker (share under luma 30
  .245 against .143).
- Horizontal lines are weaker than retail's; ledges taller than this shade
  the whole face.
- Hard seams every 90 px could read on a hill painted all round.
- On green-2 the beds arch with the hill's outline where retail's rows are
  nearly level.

### G3. Archipelago rings

> Red rings: a bit better, maybe too saturated or dark, and they should
> fade into the underlying sand better instead of just stopping abruptly.
> One thing retail seems to do is offset faded copies as you transition
> from the hill to the sand to create a more natural scattered look.

- The rings stop at a line today. Retail's step outward in several
  copies, each offset from the last (not concentric), each lighter and
  less saturated, until they are sand.
- **Server and guard:** port 8855, CDP 9655, guard `--worlds archipelago`.

**Done (merged 2504468a4; EXPERIMENTS row 121).**
- The fringe is a stack of offset, scalloped copies of the hill outline in
  retail's rose, paler outward, over a pale skirt that steps lighter into
  the sand, with a reach that varies along the outline.
- `ringShift 0` with the old ring values reproduces the earlier look bit
  for bit. The chunk renderer's direct reach covers the copies' offset.

**Still open:**
- Retail's net is denser and darker near the hill.
- Retail's halo has one wide side per hill, on the gentle ramp.
- Retail's skirt is the hill's own olive carried outward; ours is a lime
  tint over sand.

### G4. Painted Desert colour and grey bands

> Much improved. Are we using the right color? Retail reads a tiny bit
> more red than our orange. Maybe double check?
>
> desert-1: good but the retail gray band seems to repeat
>
> desert-3: the top of the plateau has much more color variation than
> retail

- **Measured,** on flat ground (the 40% of each window with the least
  local change in luma):

  | Window | Retail hue, R/G | Ours hue, R/G |
  | --- | --- | --- |
  | desert-1 | 27.0°, 1.25 | 29.9°, 1.20 |
  | desert-2 | 30.1°, 1.18 | 28.1°, 1.23 |
  | desert-3 | 32.4°, 1.16 | 34.5°, 1.12 |

  The owner is right on desert-1 and desert-3: about 2-3° of hue on the
  base ground, not a palette change. desert-2's flats are already redder
  than retail's, so find out whether they use the same material before
  shifting all three.
- **desert-1:** retail's grey band appears more than once up the strata.
  Ours has one.
- **desert-3:** the plateau top needs less colour variation. Look at E8's
  `baseVary` and the strata colour on the cap.
- **Server and guard:** port 8856, CDP 9656, guard `--worlds desert`.

**Done (merged 486ae20f2; EXPERIMENTS rows 113-115).**
- The orange beds are redder: hue 26.0/23.8/25.4 to 23.2/21.8/22.4 against
  retail's 21.9/21.4/21.8. The plain itself already matched.
- Pale caps are one sheet (`desertCapFlat`): desert-3's blotchy top is
  gone.
- `measure/desert_hue.py` classes the colour by the height it shows.

**Still open:**
- desert-1's repeated grey band: retail's second band sits on a ledge
  under the cap that our plateau profile lacks. It is form.
- Retail's one ragged orange patch per cap.
- desert-2's plain (hue 28.1 against 30.0), the Triad's pebbles and rubble
  halos, cap grain (luma s.d. 16-23 against 32-35).

### G5. Lava layers and hill rock

> Way better fingers and shore layers. The layers should still allow a
> bit more variation like retail.
>
> Rock shine is okay, but the hill rock style is still not right. It's a
> different type of rock, bumpy with cutouts, shine, and it almost reminds
> me of like a stalagtite formation.

- **Layers:** more variation through E10's knobs (`layerVary`,
  `layerRough`, their ranges and defaults) first, then the coast pass
  itself if the knobs cannot reach retail's variation.
- **Hill rock** is a new look for Lava hills, separate from the shore
  layers. Before any code, describe retail's at 2x on lava-1..3 in
  NOTES.md: the bumps, the cut-outs, the hanging drip-like shapes and
  where the shine sits. Then build it in the shaders.
- **Server and guard:** port 8857, CDP 9657, guard `--worlds lava`.

**Done (merged 4445941c5; EXPERIMENTS rows 127-128).**
- Layers wander, pinch and vary (`lavaMeander`, `lavaSpread`,
  `lavaCircleVary`); the step crease breaks into dashes
  (`lavaCreaseVary`). The coast pass's reach, `circleSites` and
  `regionalReadApron` follow.
- Hill rock is a crust (`lavaCrust` in `relief-bake.wgsl`): pillows,
  chips, cut-outs and veins, stronger with height; `lavaDusk` darkens
  tall hills' far sides; `lavaTread` tilts lobe treads.

**Still open:**
- Retail's lobe crowns are bright olive with chips and thin dark
  crescents; ours are mid-brown. A convexity-gated glint is the lever.
- The veins are faint beside retail's dendritic roots on lava-1.
- lava-2's circles keep near-black outlines.
- The wider coast reach makes lava-1 on a 4x4 map need about 669 MB of
  field working memory, over the default 665 MB page budget.

### G6. Ice: shelf lines, ice-2, ice-3 and geometric shapes

> Ice shelf is great, could mayber use some finer lines
>
> I prefer the previous mountain from ice-1, the new one does not look
> good at all. This might be a fluke in the retail ice-1, and we could
> leave our original as-is and ignore that specific weird retail
> mountain. What I do think might be worth taking is some geometric
> shapes, but not just pasting on a cube or two.
>
> ice-2 is good but probably too rough
>
> ice-3 the shape just sticks out like a sore thumb, I don't know what to
> do about that one. need help.

- **ice-1** is already back to the earlier mountain (variant `snow`).
  Geometric shapes are an option, off by default. They are angular facets
  that belong to the mountain: breaking out of the snow, lit by the same
  sun, partly buried. Today's crystal strokes are the pasted cubes the
  owner means.
- **Frost shelf:** finer lines. Keep the rest; the owner likes it.
- **ice-2:** less rough.
- **ice-3** (the owner asked for help). The form is right: its heights
  come from the retail map (3c414bd9a). The material is wrong:
  - Retail paints the block as a soft, snow-covered mesa. It has a white
    top with a few pits and faces with soft shading and smooth hatching
    down the slope. Dark hatched drift lines spill past its foot into the
    snow, so it sits in the ground.
  - Ours is a faceted frustum: a grainy, metallic slate texture, hard
    crease lines between faces, a crisp outline and nothing around its
    foot. That is why it stands out.
  - The work: snow on the flat tops of raised ice; rounded crest shading
    with no straight creases; smooth hatching down the fall line instead
    of grain; a hatched apron at the foot, fading into the snow. Compare
    ice-3 under the variant `snow` too, in case the default slate (E6) is
    what makes it metallic.
- **Server and guard:** port 8858, CDP 9658, guard `--worlds ice`.

**Done (merged 6dcdb441b; EXPERIMENTS rows 124-125).**
- ice-3: rounded light, snow on flat tops, smooth fibres down the faces
  and a hatched apron (`iceSoft`, `iceSnow`, `iceFall`, `iceApron`).
- Frost shelf hairlines (`iceFrost`), found through a small trace the
  frost stamp writes into the routes plane.
- ice-2 less rough, partly through its scene's berg form (own commit).
- Angular facets (`iceFacets`, `iceFacetSize`) on hills and mountains,
  off by default; `repro/demo/ice-facets.json`.

**Still open:**
- ice-3 is still a straight-edged frustum; retail's has rounded corners, a
  larger top and a fuzzy north rim. Its lit face is grey-teal against
  retail's light blue, and the apron is narrower.
- Frost lines are straight runs; retail's curve, with Y seams.
- Facets look tile-like at large sizes.

### G7. Crystal craters and small shore crystals

> Amazing
>
> crystal-1 needs craters / holes to have smaller less defined crystals
> and light them as a crater/hole properly
>
> crystal-2 and crystal-3 need smaller shore and shallow crystals

- **Craters:** smaller, softer-edged facets, under the shading of a hole:
  the wall facing the sun lit, the far wall shaded. E7's crater facets are
  laid in `sculpt.js` (the crystal rect).
- **Shore and shallow crystals** on crystal-2 and -3: smaller cells
  (`crystalShallowPx` and its relatives).
- The owner called the rest amazing. The mound tops and every other
  window stay as they are.
- **Server and guard:** port 8859, CDP 9659, guard `--worlds crystal`.

**Done (merged f465ee4d8; EXPERIMENTS rows 119-120).**
- Craters are lit holes under a thin wandering web: small low facets, one
  skin mark, the web drawn by the shader, stronger light and shade on the
  walls.
- Finer shore slabs and shallow cells.

**Still open:**
- Retail's crater web is denser and wavier, and its craters have no
  raised rim.
- crystal-1's third crater: the west wall is too dark.
- crystal-2's land slabs are tall dark prisms.
- The shore and shallow knobs are world-wide, so crystal-1's pond changed
  too (closer to retail's hairline cracks).

### G8. Moon, redone from a visual study

> No. This needs a redo to re-evaluate and understand the moon hill/crater
> surface better. This is rough, with some 3d pockmarks, no individual
> scratches. Use visual review because we are way off and made it worse.

Wave 2's loop matched statistics, and the result reads as pepper. This
card works from pictures: crops at 1:1 and 2x of retail moon-1..3 and of
other retail Moon maps (`$R/retail-moon`). Write down what differs before
writing code. Statistics serve only as a guard.

What the owner's session saw at 2x (moon-1's crater wall, moon-3's ridges
and moon-2's wrinkle ridges):

- **Pockmarks are 3D cups,** about 4-8 px across. Each is a dark hollow
  with a lit lip on the side facing the sun. They pack densely on shaded
  slopes, like hammered metal, and are sparse on tops. Ours are black
  pixel dots with no lit side.
- **Lit tops are lighter,** crossed by a fine network of thin, slightly
  dark lines that wander. These are wrinkles, not straight scratches and
  not streaks down the slope.
- **Shaded flanks** break into short dark ribs running down the slope,
  with a stringy texture.
- **Ridges fold.** Thin wavy lines curve around the forms, and the
  outlines are lumpy and lobed. That outline is form, so shape it in the
  brush (rule 6).
- **No individual scratches.** The fine hair-like streaks on our slopes,
  before and after E6, are what the owner means. Take them out of the
  default.

E6's `pockmark` and the variant `cracked` stay as choices. The new
surface becomes the default.

- **Server and guard:** port 8860, CDP 9660, guard `--worlds moon`.

**Done (merged 04d8516da; EXPERIMENTS row 126).**
- The hair-like scratches were Moon's band lines: `banding` 0.
- Lit cups on shaded steep faces (`moonCups`), stringy flanks
  (`moonRibs`), wandering folds (`moonFolds`), lobed outlines (the
  `moonLobes` shape option, with its read reach).
- Pepper on lit ground is now near retail's. E6's dots are the variant
  `pitted`; `cracked` stays.

**Still open:**
- moon-2's crinkled dome tops.
- Retail's walls are a wide mid-grey gradient with mottle; ours are a
  crisp near-black band.
- Folds are more regular than retail's tangled bundles.
- Retail's walls are several parallel narrow ridges: a ridge-bundle brush.

## Cards H: the terrain engine

From the owner's direction of 2026-10-28. Read
[docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md) first: it explains the five
stages these cards build toward, and why drift is allowed. Green goes first.
Keep the other worlds in mind, and gate everything to Green (rule 4). From
H8 on, every world runs the engine and cards are cut by feature (decisions
12-15).

> **Owner, 2026-10-28:** I want to see Gaea level realistic geology and
> weathering/decay if possible. Btw one important thing I didn't mention is
> that the rock geology should probably have 3d relief so the lighting is
> accurate.

**Drift rule for H cards.** A Green window may move away from its
`before` render, as long as it moves toward retail. The other worlds must
still match exactly (`compare.py ... --worlds green` exits 0).

### H1. Lit relief: close shadows, cavity occlusion, review sun (Green)

**What is there today.** In baked-relief mode (the default),
`surfaceHeight` in `sculpt-common.wgsl` is the authored height plus
`bakedFields(p).r * u.detail` plus debris. The projection, normals and
occlusion all read it. The beds already step: `bedRelief` in
`relief-bake.wgsl` has a riser, a lip and a notch, and gives each bed its
own hardness (`bedPunch`). What the lighting misses:

- **Cast shadow.** `visibility()` in `sculpt-frag.wgsl` samples at
  d = i²·1.4 + 2, that is 3.4, 7.6, 14.6 … px. Nothing closer than 3 px is
  sampled, so a 1-3 px ledge never shades the ground beneath it.
- **Occlusion.** `occlusion()` samples at 8-36 px. There is no term at the
  scale of a crevice.
- **Gradients.** Some looks may light a gradient that is not part of
  `surfaceHeight` (frag-side additions to `g`).

G2's open items are this card's targets:
- crevice share under luma 30 on green-2's face is .143, against retail's
  .245;
- the horizontal lines are weaker than retail's;
- ledges any taller than they are now shade the whole face.

**Deliver.** Gate each item with a `KNOB_DEFAULTS` knob whose default
reproduces the old output, set only in Green's `WORLD_KNOBS`.

1. **Audit.** For Green, list every lighting reader and the height or
   gradient it reads: diffuse normal, `visibility`, `occlusion`, shine and
   glints, the projection. Put the table in NOTES.md. Anything that lights
   a gradient missing from `surfaceHeight` either moves into the bake, so
   that it becomes surface, or is listed with the reason it can't.
2. **Close shadow** (`closeShadow`).
   - A short march toward the sun over `surfaceHeight`, at 1-6 px (for
     example 1, 1.5, 2, 3, 4 and 6).
   - Soft: the penumbra comes from how far the blocker clears the ray.
   - Combined with the far taps.
   - It must hold at 1× and 2× zoom, and in chunked full-size maps. The
     chunk renderer's bake reach must cover the march (see G2's reach
     note).
   - Close shadow and cavity run only when `u.full != 0`. The drag preview
     keeps today's taps.
3. **Cavity occlusion** (`cavity`).
   - Compare the surface height with the mean of a ring 1-3 px out.
   - Darken crevices and the floors of cracks: fully on the ambient term,
     and less on the direct term.
   - Keep it separate from the broad `occlusion()`.
4. **Beds under the new light.**
   - With items 2 and 3 on, retune `bedLedge`, `bedPunch`, `cliffRise` and
     `bedLip`, so that hard beds cast a short shadow and a line the eye can
     follow (E3, E9).
   - Do not rewrite `bedRelief`. If the shape itself has to change, say why
     in NOTES.md.
5. **Review sun.**
   - A URL parameter `sun=<azimuth>,<elevation>` in degrees overrides the
     light for review only. Export and server saves never use it.
   - `repro/render.mjs` may take an optional extra query string.
   - Render green-1..3 in Clay at the TA sun and at three others: azimuth
     +90°, azimuth +180°, and elevation 15°.
   - Ledges, cracks and facets must shade with the sun. A dark line that
     stays dark all the way round is ink, and is a finding.
6. **Cost.**
   - Measure the draw time at full quality (the timing label) and the
     relief bake time, before and after, on green-2 and on a 4×4 map.
   - Aim for at most +25%. Report the numbers either way.

**Judge**:
- on green-1..3 (rule 5), palette on;
- green-2's face, rows 600-880 of `ours.png` and `retail.png` (the band
  that EXPERIMENTS rows 98 and 118 measured):
  - mean luma;
  - luma s.d.;
  - share under luma 30;
  - 90th-percentile gradient.

  Retail is 45.8, 27.2, .245 and 17.6. Row 118 has today's values. Write
  the script under `$R/agent-H1/`, and record its mask in NOTES.md so that
  H2 can repeat it;
- the four-sun Clay sheets;
- guard `--worlds green`.

**Done when** NOTES.md has:
- the audit table;
- the four-sun sheets;
- crevice share before and after;
- the cost numbers;
- the review sheets.

**Server and guard:** port 8861, CDP 9661, guard `--worlds green`.

**Done (merged 988af93; EXPERIMENTS rows 129-131).**
- **Close shadow** (`closeShadow`, Green .8): six taps 1-6 px toward the sun
  over `surfaceHeight`, soft by how far the blocker clears the ray. It also
  masks the glints.
- **Cavity** (`cavity`, Green .6): the surface against the mean of a 1-3 px
  ring. Ambient loses all of it, direct light .45 of it.
- Both run in full draws only. They sit inside the far taps' chunk reach.
- **Green's beds are lower:** `cliffRise` 16 → 8, `bedLedge` .6 → .4, `bedLip`
  3 → 2. Taller ledges now shade the whole face.
- **Review sun:** `?sun=<azimuth>,<elevation>`. The azimuth is added to the
  world's own sun. Exports and saves ignore it. `repro/render.mjs` gains
  `--query` and `--clay`.
- **green-2's face**, measured on x 20-880, y 650-870, which reproduces the
  retail numbers; `$R/agent-H1/face.py` also prints the wider rows 600-880.
  Mean, s.d., share under 30, p90 gradient:

  | | mean | s.d. | share under 30 | p90 gradient |
  | --- | --- | --- | --- | --- |
  | retail | 45.8 | 27.2 | .245 | 17.6 |
  | G2 | 46.9 | 23.3 | .143 | 14.8 |
  | now | 44.7 | 26.4 | .247 | 17.6 |
- **Draw time** on green-2 rose from 18.0 to 22.0 ms (+22%). The other 24
  windows are bit-identical.
- **The audit:** the normal, the projection, every shadow and every
  occlusion term read `surfaceHeight`. The slope gates read the authored
  slope on purpose. The shine grain is a screen-pixel tilt. `crackDark` and
  `faceDark` are still ink on the material.

**Still open:**
- **The cavity term reads as ink.** It draws a dark dashed line along the
  beds that stays dark under every sun. That is ambient occlusion by
  design, but it reads as a drawn line.
- **Up close, retail's face is crisper.** It is crisp blocks outlined by
  continuous crevices; ours is softer blobs. That is the relief's shape,
  not its lighting: H2.
- Retail's long horizontal ledge lines are still missing, and the beds
  still arch with the hill (G2).
- The hill above green-2's face gets denser dark rows than retail's smooth
  diagonal ridges.
- There are no panel sliders for the new knobs.
- The 4×4 cost is unresolved: chunk bake times were bimodal with the knobs
  on and off. Seams were checked in one corner only.
- `crackDark` could be lowered now that cavity darkens the same floors as
  geometry.

### H2. Rock column, plus erosion on the GPU (Green)

**What is there today.**

- **Weathering.** The Weathering box is on by default, so every repro
  render includes it. `queueWeather` in `sculpt.js` sends the height to
  `sculpt-weathering.js`, a CPU droplet worker, on the study's 512-sample
  grid (2 px a sample). It returns:
  - the weathered height (`refined`), which the art and the export's TNT
    corner heights read;
  - flow, deposit, talus and sand, which `setWeather` puts in layer 0 of
    the grid texture. `weatherAt` reads them: the bake's boulder-foot rule
    and the fragment shader's deposits;
  - the material field (layer 1).
- **The worker keeps the design intent:**
  - it never changes a sample whose protection is above 0: ramp grades,
    plateau interiors and buildable crests (see "Design intent survives
    weathering" in `sculpt.js`);
  - it leaves submerged samples alone;
  - it keeps each sample between its own lower and upper bounds, and
    between sea −90 and sea +300.
- **Beds.** `bedRelief` in `relief-bake.wgsl` draws them.
  - Green spaces them by height (`bedHeight` 1, `bedSpacing` 5).
  - Since G2 they follow the ground's smoothed contours (`cliffFollow` 1,
    `cliffBed` .3), so the bed coordinate comes from a smoothed height.
  - Each bed's hardness is a hash: `bedPunch` scales its riser by
    `0.3 + 1.4 * cellHash(vec2f(k, 9.1)).y`.
  - Erosion knows nothing of the beds.
- **Shaders.** `preprocess` in `sculpt-renderer.js` pastes
  `sculpt-common.wgsl` at `/*COMMON*/` and keeps `#ifdef` blocks by define;
  the bake compiles with `BAKE`. A new compute shader can share the common
  code the same way.

**Scope.**
- The 1024-px study only, which is the path every repro scene takes, and
  Green only.
- Map canvases, including maps over 1168 samples with tiled weather, keep
  the droplet worker. They are H2b.
- The two questions left for H1's review:
  - The GPU pass runs beside the droplet worker, chosen by a knob. The
    worker stays the default for every other world and for map canvases.
  - H2 needs no new mask planes: its outputs go where the worker's go.
    H2b's stored planes are what take planes 14-19 and 25+.

**Deliver.** Gate everything (rule 4). Do items 1-3 first. If they use up
the card, stop there with NOTES.md; items 4 and 5 can follow as their own
card.

1. **Rock column** (`column`; 0 keeps today's hash).
   - **Data:** up to eight beds that repeat upward. Each has a thickness in
     height units, a hardness from 0 to 1, and a material slot for H3
     (unused here). Pass them as a uniform array appended to
     `struct Uniforms`, from a Green preset in `sculpt.py`.
   - **`columnAt(p, z)`** in `sculpt-common.wgsl` returns the bed index, its
     hardness, and how far through the bed z lies. The bed coordinate is
     the height plus the existing tilt (`bedDip`, `bedDipDir`) and wander.
     So it depends only on (x, y, z), and erosion that lowers the ground
     exposes the bed beneath.
   - **`bedRelief`** reads hardness and thickness from `columnAt` in place of
     the hash. With `column` 0 it must be bit-identical.
   - **One coordinate.** The bake and the erosion pass must read the same
     bed coordinate. If erosion reads the raw surface while the bake reads
     G2's smoothed one, the ledges erosion leaves and the ledges the bake
     draws drift apart. Choose one and say why in NOTES.md.
   - Eroded flat beds may follow the hill by themselves. If they do, try
     Green with less `cliffBed` or `cliffFollow`, and keep it only if it is
     closer on all three windows.
2. **GPU erosion** (`erosion`: 0 the droplet worker, 1 the GPU pass).
   - **Files.** A host module `sculpt-erosion.js` and a compute shader
     `erosion.wgsl`, run on the renderer's device, with the common code
     pasted under an `EROSION` define. Add both to `sculpt.py`'s list of
     served files.
   - **Model.** Grid-based, with no particles: the virtual-pipe shallow-water
     model of Mei, Decaudin and Hu (2007, cited in the worker's header) for
     water, outflow, velocity, sediment capacity, erosion, deposition and
     transport. Then thermal weathering down to an angle of repose.
   - **Hardness.** Erodibility comes from `columnAt` at the current
     surface: soft beds wear fast and hard beds stand. Hard rock keeps a
     steep repose and loose debris a shallow one.
   - **Deterministic.** A fixed number of iterations (`erosionAge`),
     ping-pong buffers, no atomics, and one writer per cell per dispatch.
     The same input gives the same bits on this machine.
   - **The worker's contract.** Honour `protect`, leave submerged samples
     alone, and keep the worker's bounds. Read the worker first, then list
     each of its rules in NOTES.md and whether the pass keeps it.
   - **The worker's outputs.**
     - The height goes to `refined`, so the art and the TNT corners read
       it as today.
     - Flow, deposit and talus are 0-1 with the worker's meaning, so every
       `weatherAt` reader still works.
     - Sand and the material field still appear.

     The simplest route is probably to run the GPU pass, then hand its
     height to the worker with the droplet loop skipped, so the material
     field, sand and the apron run as today. Say what you did.
   - **Rain** falls evenly on dry ground. A rain mask is FLOW_BAKE's open
     item, not this card's.
   - **At most four knobs** a user would see: `erosionAge`, `erosionRain`,
     `columnContrast` (how much harder the hard beds are) and `talusAngle`.
     Everything else is a constant, with a comment saying why.
   - The weather label shows the pass and its time, as the worker's does.
3. **Demo mesa** (`repro/demo/mesa-beds.json`, Green).
   - A mesa about 120 height units high, with steep sides on painted rock,
     over a column of alternating hard and soft beds. No stroke draws a
     bench. If the plateau stroke protects its own sides, use a stroke
     that does not.
   - With erosion on:
     - the hard beds stand as cliffs;
     - the soft beds retreat to slopes;
     - talus gathers at the cliffs' feet.
   - **Evidence:**
     - Clay renders at the TA sun and at azimuth +90;
     - a height profile across one side, before and after erosion, marked
       with the hard beds' heights. The benches should sit on the hard
       beds. Count them **[measured]**.
   - `all.sh` only runs `scenes/`, so render the demo with `render.mjs`.
4. **Crisp blocks** (after items 1-3).
   - Retail's face is crisp blocks outlined by continuous crevices; ours is
     soft blobs (H1's open item).
   - Joints cut each bed into blocks. Give each block its own plane with a
     small tilt, and keep the crevices continuous along the bed boundaries
     and the joints. Through the column, hard beds make larger and cleaner
     blocks.
   - The blocks may replace Green's facets (`facetTilt`) on the face, if
     that is closer.
   - **Measure** with `$R/agent-H2/runs.py` on green-2's face (x 20-880,
     y 650-870): the share of dark pixels (luma under 30) in horizontal runs
     of 10 px or more, and in vertical runs of 6 px or more. Retail's
     crevices run along the beds; ours run down the face:

     | | horizontal, 10 px or more | vertical, 6 px or more |
     | --- | --- | --- |
     | retail | .071 | .248 |
     | H1 | .028 | .340 |
5. **Green's preset.** With items 1-4 on, set Green's knobs. Judge
   green-1..3 against retail (rule 5) and against `before`. H1's face
   numbers (`$R/agent-H1/face.py`: mean, s.d., share under 30, p90
   gradient) must not get worse beyond noise. Retail is 45.8, 27.2, .245
   and 17.6; H1 is 44.7, 26.4, .247 and 17.6.
6. **Cost and determinism.**
   - Time the GPU pass on the 512 grid against the worker (its label prints
     milliseconds). Time the relief bake and the full draw on green-2,
     before and after.
   - Render green-1..3 twice, restarting the server between runs.
     `compare.py <run-a> <run-b> --worlds none` must exit 0.

**Judge**:
- the demo mesa (item 3);
- green-1..3 with the palette on;
- H1's four-sun Clay sheets (`render.mjs --clay --query
  sun=<azimuth>,<elevation>`): every ledge must shade with the sun;
- the face numbers and the dark runs;
- guard `--worlds green`.

**Done when** NOTES.md has:
- the column preset, and why;
- the erosion model, its knobs and defaults, and which worker rules it
  keeps;
- the mesa evidence;
- the face numbers and dark runs, before and after;
- the cost and the determinism check;
- the review sheets;
- what H2b will need.

**Server and guard:** port 8862, CDP 9662, guard `--worlds green`.

**Done (merged as fef3abb; EXPERIMENTS rows 132-134; notes in
`$R/agent-H2/NOTES.md`).** Items 1-3; item 4 was not started.
- **Rock column** (`column`, `columnContrast`, `columnBeds`). `columnAt`,
  `columnCoord` and `columnOffset` are in `sculpt-common.wgsl`; the bake and
  the erosion pass share them.
  - Green's column is eight beds repeating every 47 height units, thin hard
    beds between thicker soft ones:
    `4:.9,7:.2,3:.7,8:.15,5:1,7:.3,4:.6,9:.2`.
  - The bed coordinate is the surface height at the pixel, plus tilt and
    wander. So with `column` 1, G2's smoothed ground (`cliffBed`) is ignored:
    the pass cannot reproduce that smoothing, and two coordinates would
    drift apart.
- **GPU erosion** (`erosion`, `erosionAge` 200, `erosionRain` 1, `talusAngle`
  40) is in `erosion.wgsl` and `sculpt-erosion.js`:
  - virtual-pipe water with sediment, then thermal slides with two reposes;
  - wear and repose follow the bed's hardness;
  - 200 fixed iterations, ping-pong buffers, no atomics; two runs with a
    restart between them match exactly.

  It runs on the study only (`!regionalFields`). The worker then runs with
  its droplet loop skipped: apron, sand and the material field are as
  before.
- **Budget.** The pass may move the ground 3 times as far as the worker's
  largest budget, falling to .35 within 20 units of the sea. That is a
  departure: at the worker's budget, a 100-high mesa's foot saturated.
- **Demo mesa** (`repro/demo/mesa-beds.json`): continuous bench lines wrap
  the face and shade with the sun. 2 of 5 hard beds stand (slope at least
  1.25 times their soft neighbours) and 2 of 5 soft beds retreat.
- **Green barely changes.** green-2's face numbers are within noise of H1
  (mean, s.d., share under 30, p90 gradient: 44.1, 26.0, .252, 17.4; H1
  44.7, 26.4, .247, 17.6). Dark runs are .032 / .354 (H1 .028 / .340,
  retail .071 / .248). By eye, at 1× and 2×, the windows look the same.
- **Cost.** The pass takes 250-320 ms against the droplet worker's 673 ms on
  green-2 (427 ms with the rest of the worker). Draw and bake times are
  unchanged.
- **Merge checks.**
  - All 27 scenes match the agent's final renders exactly, and only Green
    moved against `merge-h1`.
  - A 4×4 Green map canvas renders and exports with no seams or console
    errors. 3% of its art moved, all on the rock face, from the column.

**Still open:**
- **The 2-px grid cannot resolve the beds.** A 6-10 unit bed on a face of
  slope 2.5 spans 1-2 samples, so grid erosion makes benches on big forms
  but not on Green's faces. The face's look has to come from the rock
  material's relief: item 4's crisp blocks move to H3.
- Map canvases keep the droplet worker (H5).
- The worker still runs the apron, sand and the material field on the CPU
  (H3 and H5).
- Not run on the GPU path: the worker's slope-detail seeding before the
  droplets.
- There are no panel sliders for the new knobs.

### H2b. Erosion on map canvases — outline

This now belongs to H5 (Green's weather on the GPU everywhere) in
[docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md#cards).

- A coarse pass over the whole map, then fine tiles with aprons, so that
  drainage reaches across tiles.
- It follows the flow-bake node pattern: region, hash, Bake button, stale
  badge and the idle option.
- **Stored planes**, which take planes 14-19 and 25+:
  - the height change, at better than Int8 precision;
  - flow, wear, deposit and talus.

  Regional replay copies them. Export reads them and never simulates.
- It answers FLOW_BAKE's open question: a general control for flow and
  erosion on land, such as a rain mask and a direction.
- Whether the GPU pass replaces the worker for a world is settled when that
  world is ported.

### H3. One material model, from numbers, on the GPU (Green)

> **Owner, 2026-10-29:** "what I want most is everything on the GPU, a
> simplified/unified geology/surface/erosion/texture model that can still
> mimic retail terrain features, and fast progressive rendering." On this
> card: "work with the existing images. I'm not exactly sure what it's
> doing, but we should codify the retail information in some way that no
> longer requires it when running to keep things simple and allow for easy
> cloud development."

Read [docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md) first, including
"Rules for the cards", which this card follows. Note the provenance rule:
tables measured from retail art are fine to keep, but retail pixels are
never a run-time input and never go in git.

**What is there today.**
- **Prepared images.** Green's look comes from images under
  `$R/assets-green/`. A Python preparation made them from retail art; its
  sources are gone, and every server runs `--prepared`.
  - Retail-derived: `grass.png`, `rock.png`, `slope-grass.png`,
    `slope-rock.png` (`hillRock`), `rock-weathered.png`, `rock-fractured.png`
    and the water images.
  - Ours (generated): `noise*.png`, `fractures.png` and `ground-tiles.png`.
    - `ground-tiles.png` holds 16 procedural 32×32 tiles that `ground_tiles.py`
      sampled from retail's neighbour statistics of palette indices, in an
      18-entry vocabulary, copying no retail pixel.
    - `groundTile()` scatters them one per 32-px cell by hash, so the plain
      reuses tiles as retail does.
    - Commit the tiles as numbers (palette indices); do not replace them.
      (Corrected on 2026-10-29: this card first called them cut from
      retail, and round 1 replaced them with per-pixel noise, which made
      every exported tile unique.)
  - `palette-pairs.png` is built from the TA palette.
  - `config.json`'s `material` block holds measured numbers, such as
    `rockMeanRGB` and `hillRockMeanRGB`.
- **The draw.** `fragmentMain` in `sculpt-frag.wgsl` (lines 1118-2070)
  samples those images and chooses between them through a long chain of
  knob-gated decisions: slope classes, `rockFrom`, coverage, transitions,
  paint, deposits, moss, `faceRock`, and more. Green sets 79 knobs.
- **The CPU material field.** `sculpt-material-weathering.js` computes it in
  the weathering worker (grid-texture layer 1). The draw reads it through
  `materialFieldAt`.
- **Landforms already carry paint.** A plateau, offset, hill, mountain,
  crater, deep or shallow stroke can have "Paint inside" and "Style"
  options, which `applyShapeMask` in `sculpt.js` writes over the shape's
  footprint, weighted by its influence. These are `MASK_CHOICES` and
  `STYLE_CHOICES`, in mask planes 0-13. Planes 14-19 are free.

**Scope.**
- Green's land materials: plain grass, slope grass, rock, slope rock,
  weathered and fractured rock, and any loose material (soil, sand, scree)
  its draw uses.
- Water, shore and the water bed stay as they are; they are a later card.
- The rock face's crisp blocks are H3b, after this card.
- Every other world must match `before` exactly.

**Deliver.**

1. **Inventory (no code).** For Green, with its knobs, write in NOTES.md:
   - every material the draw can show, which image or function makes its
     colour, and the conditions that place it (with line references);
   - every knob Green sets that those paths read;
   - which images are retail pixels and which are ours.

   This table is the contract for items 3 and 6.
2. **Numbers.** Write `measure/material_numbers.py`, a dev tool that is
   never run by the server. It reads each prepared image and writes the
   material's numbers to a committed table, `materials/green.json`:
   - a colour ramp: RGB at, for example, 12 luma quantiles;
   - the grain: luma amplitude in octave bands from 1 to 32 px, and any
     direction or stretch;
   - anything else a material needs to be recognised, such as dark flecks
     or two-tone mixes, and why.

   Keep the table small, so it reads as data. It replaces the images at
   run time.
3. **The material function** (`materialModel`; 0 keeps today's images).
   - One WGSL function makes a material's colour at a pixel from its
     numbers: band-limited noise with the measured band amplitudes, mapped
     through the measured luma distribution to the ramp. It reads no
     image.
   - **Footprint.** It takes the pixel size and leaves out bands finer than
     it, so a quarter-resolution draw keeps the same mean and broad pattern
     (rule: state the resolution).
   - **Swatches first.** For each material, a sheet of the prepared image
     next to the generated one, at 1× and 2×, with the palette on, and its
     numbers (mean, s.d., the s.d. after a 5-px blur, band amplitudes,
     hue) side by side. Reach the numbers before you judge the windows.
   - The map generator found that brightness plus noise never matched
     retail's palette art, but neighbour models of palette indices did
     (memory of proto/mapgen-features). If the swatches cannot get close,
     try a GPU-friendly neighbour model (for example checkerboard updates
     conditioned on four neighbours) before giving up. Record what you
     tried.
4. **One placement function.**
   - It returns material weights from the data maps: slope, height above
     the plain and the sea, curvature, the column's hardness at the
     surface, flow, deposit and talus (H2), and the paint and style planes.
   - Its rules are rows in `materials/green.json`, such as thresholds and
     blend widths, not code branches.
   - It replaces the chain of decisions in item 1's inventory, and the CPU
     material field, if the deposit and talus maps can do its job.
   - Blends compare the materials' own heights where they have relief, so
     grass lies between stones rather than fading over them.
5. **Override fields.**
   - Planes 14-17 become overrides:
     - 14, erosion;
     - 15, deposits (loose material and sand);
     - 16, vegetation (grass and moss);
     - 17, rock exposure.
   - A plane's signed value v multiplies its control by 1 + v, so an
     untouched plane (0) changes nothing.
   - Rename their `MASK_KEYS` entries (`free14`...). Saved sketches and
     documents hold zero planes there, so old saves load unchanged; check
     one.
   - The placement function multiplies by them. H2's erosion pass
     multiplies its rate by the erosion plane, read from the same planes on
     the CPU side.
   - Add them to the Paint brush and to the landforms' Style options
     (`STYLE_CHOICES`), "more" and "less" for each, so `applyShapeMask`
     writes them over a feature's footprint.
   - Demonstrate the owner's case on a demo scene
     (`repro/demo/overrides-green.json`): two hills, sand or loose deposits
     kept around one and lessened around the other.
6. **Retire.** Once Green's three windows are at least as close with
   `materialModel` 1 (rule 5), delete what the model replaced:
   - the knob-gated paths that only Green took;
   - Green's knobs that now do nothing (remove each from WORLD_KNOBS, and
     from KNOB_DEFAULTS if no world reads it);
   - Green's image reads;
   - Green's part of the Python material preparation, keeping anything
     another world still uses (list what stays and for whom).

   The three-window check and the guard must pass after the deletion. If a
   material cannot yet be made from numbers (the plain's exact tiles may
   be one), keep its image, and measure and record the gap.
7. **Map canvases.** The draw is shared, so the model also runs in chunked
   maps. Check a 4×4 Green map with `$R/agent-H3/mapcheck.mjs` (usage at
   its top): no seams, no console errors, and the export succeeds.

**Judge**:
- **The swatches** (item 3).
- **green-1..3 against retail,** palette on, at 1× and 2×.
- **Surface classes.** Use `repro/stats.py` for the windows (luma, Lab
  histogram distance, edge density, against Green's retail family), plus
  your own numbers per surface class: flat plain, grass slope and rock face.
  For each: mean luma, s.d., s.d. after a 5-px blur, and hue.
- **The face,** with `$R/agent-H1/face.py` and `$R/agent-H2/runs.py`. They
  must not get worse beyond noise. After H2, mean, s.d., share under 30,
  p90 gradient and dark runs are 44.1, 26.0, .252, 17.4 and .032 / .354;
  retail is 45.8, 27.2, .245, 17.6 and .071 / .248.
- **The override demo** (item 5).
- **The guard,** `--worlds green`.

**Done when** NOTES.md has:
- the inventory;
- `materials/green.json` and how each number was measured;
- the swatch sheets;
- the window and class numbers, before and after;
- the override demo;
- what was deleted and what stays (and why);
- the simplicity table from "Rules for the cards", before and after:
  shader lines, uniforms, knobs (Green's), JS worker lines, Python
  material lines;
- the map check;
- the cost: draw and bake time on green-2.

**Order and budget.**
- Do items 1-4 first, committing per idea. If they use up the card, stop
  with NOTES.md; 5-7 can follow as their own card.
- Never merge a model that is gated but not retired: say in NOTES.md what
  item 6 still has to delete.

**Server and guard:** port 8863, CDP 9663, guard `--worlds green`.

**Done (merged as 1c7f10d after two rounds; EXPERIMENTS rows 135-137;
notes in `$R/agent-H3/NOTES.md`, whose ROUND 2 section supersedes round
1).**
- **Numbers.** `measure/material_numbers.py` and `materials/green.json`
  hold, per material, a 16-quantile ramp, a tint axis and octave-band
  amplitudes. `mmColor` (`material-model.wgsl`) draws a material from them
  with no image.
  - Only slope grass uses it: it matched its image by eye and in numbers.
  - The rocks matched in numbers but speckle where the art has facets, so
    rock, weathered and fractured stay on their images until H3b.
- **The plain** keeps its 16 procedural tiles, now stored as data in the
  table and built at startup. Unique tiles on the 4×4 export are back to
  1,067. (Round 1's per-pixel noise made all 4,420 unique.)
- **Placement.** `greenPlace` reads rows of the table, and is
  pixel-identical to the inline chain it replaces for Green.
- **Overrides.** Planes 14-17 are erosion, deposits, vegetation and rock
  exposure, applied as 1 + v. They are set by Paint channels 18-25 and by
  four Style sliders on landforms. H2's erosion pass reads plane 14.
- **Retired:**
  - `faceRock`;
  - 11 Green knobs equal to their defaults;
  - the slope-grass image and the plain's PNG;
  - Green's CPU material field, which its draw never read.
- **Merge checks:**
  - Only Green moved against `merge-h2`, and Lab histogram distance equals
    it.
  - The face numbers are within noise.
  - All 27 windows equal the agent's final renders.
  - The 4×4 map export shows no seams at three chunk crossings and no
    console errors.
  - Old saves rebuild their masks from strokes, so the renamed planes load
    unchanged.

**Still open:**
- **It did not simplify.** The table below compares the 467c744 baseline
  with this merge. The inline chain is other worlds' code until they port,
  and the rocks keep their images until H3b.

  | Measure | Baseline | Now |
  | --- | --- | --- |
  | Shader lines, frag / bake / common | 2,070 / 1,247 / 648 | 2,246 / 1,260 / 715, plus 123 in `material-model.wgsl` |
  | Uniforms | 350 | 356 |
  | Knobs, total / Green | 400 / 79 | 411 / 75 |
  | Python lines | 3,044 | 3,044 |
- **Draw cost:** +5.3 ms on green-2 (22.8 → 28.1 ms) for slope grass alone.
  Making each material's texture from its numbers once, at startup on the
  GPU, would remove it.
- **A landform's override reaches only its own footprint.** Deposits lie
  around a mesa's foot, so the Style slider alone barely changes them
  (0.55% of the half); the demo needs a Paint stroke as well. Features need
  a reach around their footprint.
- Rock structure from numbers: H3b.

### H3b. Rock blocks (Green) — outline

This now belongs to H4 (item 4).

- **What it adds.** Rock relief from the column: joints cut each bed into
  blocks, each block is a plane with a small tilt, and the crevices stay
  continuous along the bed boundaries and the joints. Hard beds make larger
  and cleaner blocks.
- **Why it isn't erosion.** H2 showed the 2-px erosion grid cannot resolve
  Green's beds, so this look has to come from relief.
- **Measured by** `runs.py` (dark runs; see H2) and `face.py`.
- **Replaces** Green's facets and the bed relief it supersedes, and deletes
  them (the card rules).


### H4. The Green engine: the new mechanism in its own shaders (Green)

> **Owner, 2026-10-29:** "for the purpose of proving this out we should do
> one vertical slice: green planet entirely on the GPU with the new
> mechanism. For the slowdown, generate the texture at startup on the GPU.
> ... For the per-shape overrides, leave it as-is. ... Don't worry about
> simplification of the shader or knobs for now - if this is a problem then
> just use a new shader for the new green planet work, then we can more
> directly compare."

Read [docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md) first: the decisions,
"The Green slice", and "Rules for the cards". Then read H1-H3's Done and
Still open lists above, and H3's inventory of Green's draw
(`$R/agent-H3/NOTES.md`, item 1 and the ROUND 2 section).

**What is there today.**
- **One shared draw for every world.** Green draws with the shared
  `sculpt-frag.wgsl`, `relief-bake.wgsl` and `sculpt-common.wgsl`.
  - H3's model sits inside them under the `MATERIAL_MODEL` define, which
    `materialModel` 1 turns on.
  - `initialize()` in `sculpt-renderer.js` compiles the three. The chunk
    renderer reuses the same class with `CHUNK`.
- **Green's land materials:**
  - the plain draws its 16 tiles from table data;
  - slope grass is drawn per pixel by `mmColor` from numbers, which costs
    +5.3 ms on green-2 (22.8 → 28.1 ms);
  - rock, weathered and fractured rock still read their images. The model
    has their numbers, but the generated rocks speckle where the art has
    facets.
- **Already in place:**
  - the column (H2) and Green's bed relief;
  - H1's light: close shadow and cavity;
  - `greenPlace` with its table rows, and the override planes 14-17 (H3);
  - Green's water, tuned in E1, E11 and G1.

**Scope.**
- A new shader pair for Green only, drawing everything Green draws today:
  land, rock, water and coast.
- The shared shaders stay exactly as they are, so `engine` 0 draws Green
  as `merge-h3` does, and old and new can be compared.
- Not in this card:
  - weather on the CPU (H5);
  - shape replay (H6);
  - progressive levels (H7);
  - the per-shape overrides' reach (the owner leaves it as it is);
  - every other world.

**Deliver.**

1. **The engine shaders** (`engine`: 0 the shared shaders, Green 1).
   - New files `engine-frag.wgsl` and `engine-bake.wgsl`. Give them their
     own common file only if the shared `sculpt-common.wgsl` gets in the
     way, and say why.
   - The renderer compiles them in place of the shared pair when `engine`
     is 1, in both the study and chunked maps.
   - Start by bringing over only the code Green takes, using H3's
     inventory. A branch whose knob Green leaves at its default and that
     the knob turns off is not copied.
   - **Milestone:** `engine` 1 draws green-1..3 as `engine` 0 does, before
     anything else changes. Bit-identical is the aim. If the compiler
     reorders float arithmetic (see ground rule 3), require mean |diff|
     under .1 and nothing visible at 2×, and record the numbers.
   - Commit at the milestone.
2. **Material textures made at startup on the GPU.**
   - A compute pass makes each material's texture from its numbers in
     `materials/green.json`, once at startup and again when the table
     changes. The draw then samples it like an image.
   - The textures tile seamlessly: make every noise octave periodic over
     the texture size.
   - **Mip levels** are made band by band, so a coarse draw reads the
     right level: the footprint rule, for progressive rendering later.
   - Fixed seeds; the same table gives the same bits.
   - **Target:** the engine's draw on green-2 at or below the old shared
     draw (22.8 ms), against 28.1 ms with `mmColor` per pixel. Report the
     startup generation time.
3. **Rocks from numbers.** Rock, weathered and fractured rock draw from
   generated textures too. Their facets come from relief (item 4), not
   from the texture. No image reads remain for Green's land; water keeps
   its images (item 5).
4. **Rock blocks** (H3b, folded in), in `engine-bake.wgsl`:
   - joints cut each bed into blocks;
   - each block is a plane with a small tilt;
   - the crevices stay continuous along the bed boundaries and the joints;
   - hard beds, by the column, make larger and cleaner blocks;
   - it may replace the facets on Green's face if that is closer.

   **Measure** with `$R/agent-H1/face.py` and `$R/agent-H2/runs.py`:

   | | mean | s.d. | share under 30 | p90 gradient | dark runs, horizontal ≥10 / vertical ≥6 |
   | --- | --- | --- | --- | --- | --- |
   | retail | 45.8 | 27.2 | .245 | 17.6 | .071 / .248 |
   | now | 44.1 | 26.0 | .252 | 17.4 | .033 / .350 |

   The dark runs should move toward retail. The rest must not get worse
   beyond noise.
5. **Water as it is.**
   - Green's water and coast come across with the milestone, unchanged
     in effect.
   - **Check:** in green-1 and green-3, water pixels with `engine` 1 equal
     `engine` 0, except where item 3 or item 4 changed the land beside
     them.
   - Moving water onto numbers is a later card.
6. **Compare.**
   - **Triptych:** green-1..3 as retail | `engine` 0 | `engine` 1, palette
     on, at 1× and 2×.
   - **Numbers:** `repro/stats.py` for the windows, and the surface
     classes (`measure/material_classes.py`, `material_lab.py`): luma s.d.,
     5-px s.d. and Lab distance for the plain, grass slope and rock face.
     The engine must be at least as close to retail as `engine` 0 on all
     three windows (rule 5), and closer on the face.
   - **Size,** for comparison only (the owner has set simplification
     aside for the slice): the engine shaders' lines against the shared
     ones, the uniforms the engine reads, and the knobs Green's engine
     reads.
7. **Map canvases.** Green maps draw with the engine. Run
   `$R/agent-H4/mapcheck.mjs` (usage in its first line), and look at the
   export at 2× across chunk crossings. Required:
   - no seams;
   - no console errors;
   - an export that succeeds, with unique tiles near 1,067 (H3's number).

**Judge**:
- the milestone (item 1);
- the triptych and the numbers (item 6);
- the face and dark runs (item 4);
- the four-sun Clay sheets (`render.mjs --clay --query
  sun=<azimuth>,<elevation>`): blocks and ledges must shade with the sun;
- draw time (item 2);
- the guard: `compare.py ... --worlds green` against `before`, and
  `engine=0` must reproduce `before`'s Green exactly.

**Done when** NOTES.md has:
- the milestone numbers;
- the startup pass: what it makes, its time, and the mip levels;
- the rock and block results against retail;
- the water check;
- the triptychs and the numbers, `engine` 0 against 1 against retail;
- the size comparison;
- the map check;
- draw and bake times, with `engine` 0 and 1 alternating, a median of 7
  each.

**Order and budget.**
- Items 1 and 2 first: the milestone, then the startup textures. Each is
  its own commit.
- Then 3 and 4 together, since rocks lose their facets until the blocks
  exist. Then 5-7.
- If the budget runs short, stop after any item with NOTES.md saying what
  remains.

**Server and guard:** port 8864, CDP 9664, guard `--worlds green`.

**Done (merged as 494bcf1 after two rounds; EXPERIMENTS rows 138-140;
notes in `$R/agent-H4/NOTES.md`, whose round 2 section supersedes round
1).**
- **Green's own shaders.** `engine` (Green 1) draws and bakes with
  `engine-frag`, `engine-bake` and `engine-common`.
  - Before any change they drew bit-identically to the shared set on all 27
    scenes.
  - `engine` 0 still reproduces merge-h3's Green exactly.
- **Startup materials.** `engine-materials.wgsl` makes slope grass, rock,
  weathered and fractured from `materials/green.json`:
  - 512 px, periodic;
  - seven mip levels, each made from the model at its footprint;
  - 7.8-10 ms at startup, and 2.3-3.7 ms to regenerate.

  No land image remains for Green. The plain keeps its 16 tiles from data,
  and water keeps its images. Against the images they replace, means are
  within .3 luma and s.d. is 2-4% low.
- **Draw cost.** The green-2 draw went from 26.5-28.2 ms to 19.0-19.8 ms
  (target 22.8). The bake costs .2 ms more.
- **Rock pieces.** `blockField` cuts the face into irregular pieces:
  - the grid is jittered and turns slowly, and its cells are sized by bed
    hardness;
  - each piece is a tilted, stepped plane, with chipped and carved crevices
    and per-pixel grit.

  Round 1 cut courses from the bed coordinate, and they read as rows of
  arcs; round 2 removed them. In Clay, the pieces shade with a moving sun.
- **Moss on rock.** `rockMoss` places flecks and small clumps of slope
  grass on exposed rock, by cavity and lump top. Measuring showed that
  green-2's face hue gap was cover: retail's non-green rock pixels are the
  same grey as ours.
- **Green-2's face** (engine 0 → engine 1; retail):

  | Measure | engine 0 | engine 1 | Retail |
  | --- | --- | --- | --- |
  | Mean / s.d. | 44.1 / 26.0 | 46.1 / 26.8 | 45.8 / 27.2 |
  | Class hue / sat | 60 / .115 | 85 / .254 | 80 / .286 |
  | Rock-face Lab | .068 | .047 | |
- **The controls matter on the structured face.** Each block knob and
  `rockMoss` moves 31-63% of green-2's face between its minimum and
  maximum (`out/impact2-sheet.png`, 1× crop pairs).
- **Merge checks:**
  - Only Green moved against merge-h3 (mean |diff| 1.02 / 4.82 / 0.73).
  - All 27 scenes equal the agent's final renders.
  - Replay mismatch is 0, and the console is clean, on all 27.
  - The 4×4 export has 1,067 unique tiles of 4,420, no nearest pixels and
    a clean console.
  - The map path draws the engine: 35-40% of canvas pixels move between
    `engine` 0 and 1.
  - Seam shots with rock in view show no seam.

**Still open:**
- **Long horizontal dark runs.** h≥10 is .024 against retail's .071
  (engine 0: .033). Taller steps with close shadow did not lengthen them.
- **Green-1 and green-3.** Rock-face Lab is .003 and .002 worse than engine
  0, and grass slope .001-.002 worse. It comes from the generated rock's
  own arrangement, and is within the .006 noise that earlier cards used.
- **The moss reads as confetti.** Its flecks are brighter and more evenly
  spread than retail's darker clumps in crevices. Placing it by the water
  pass's wetness (H5) is the natural next step.
- **Shaded pieces** are darker and mushier than retail's.
- **Blocks only on big faces.** Green-1 and green-3's rock is small hills
  outside the face gate, where every block knob moves under 1%. Owner
  question: should blocks reach hill rock, with their own gate?
- **`rockMoss` has two meanings:** the moss amount under engine 1 (Green
  .4), and the old green clamp under engine 0 (Green .15).
- **Size, for comparison only.** Nothing is deleted until the slice is
  accepted (decision 10). The engine copies still carry other worlds' dead
  branches.

  | Measure | Shared | Engine |
  | --- | --- | --- |
  | Shader lines, frag / bake / common | 2,246 / 1,260 / 715, plus 123 for the material model | 1,933 / 1,317 / 724, plus 127 for the materials pass |
  | Uniforms read by frag and bake | 341 | 325 |
  | Knobs, total / set by Green | 420 / 76 | 420 / 84 |

### H5. Green's weather on the GPU, at TA's scale (Green)

> **Owner, 2026-10-29:** "remember the scale of Nanolathe/TA because that is
> our target. We aren't 10,000 feet up in a jet where details are washed
> out. I want to see pixelated grit, boulders, rocks, gravel, sand, gouges,
> scratches, etc. The controls and sliders we keep on the simplified GPU
> simulation to control the base geology, rock types, weathering, etc needs
> to be impactful and not just change a couple pixels at the base of a hill
> that nobody would notice."

Read [docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md) first: the decisions
(4 and 11 above all), "Time", "Surface", and "Rules for the cards". Then
read H2's and H4's Done and Still open lists above, and `$R/agent-H4/NOTES.md`.

**What is there today.**
- **The study (1024 px, grid 512, 2 px a sample).** With `erosion` 1 (Green):
  - `renderer.erode()` runs `erosion.wgsl`: pipe water and thermal slides,
    200 iterations, 250-320 ms. It runs inside an envelope around the
    authored height, 3× the worker's budget and .35 near the sea
    (`sculpt-erosion.js`).
  - It then hands the height to the CPU worker `sculpt-weathering.js`. The
    worker skips its droplets but still makes the apron (talus), sand
    (`sculpt-sand.js`) and the flow and deposit fields.
  - These reach the draw as `gridTexture` layer 0 (flow, deposit, talus,
    sand; rgba8, `setWeather`).
- **Map canvases.** Maps up to 1168 samples a side (a 4×4 map) run the
  global CPU worker with its droplets; the GPU pass is study-only
  (`!regionalFields`). Larger maps run `sculpt-tiled-weather.js` (256-sample
  cores, 64 blend, 128 apron). TNT corners and export read the weathered
  height.
- **Engine 1's bake** (`engine-bake.wgsl`) already places stones from
  fields: `boulders()` and `debrisStones()`. H4's `rockMoss` places moss by
  cavity.
- **It barely shows.** H2's erosion moved 1.8% of green-2's samples by
  more than a height unit, and Green's windows barely moved (EXPERIMENTS
  133). The four Time knobs (`erosionAge` 200, `erosionRain` 1,
  `columnContrast` 1, `talusAngle` 40) have never had their impact
  measured.

**Scope.**
- Green's engine (`engine` 1) only, on the study and on maps up to 1168
  samples, where one whole-map pass covers the map.
- **`engine` 0 must keep drawing Green as `merge-h4` does.** Put engine 1's
  pass changes in engine-only files or behind uniforms that only engine 1
  sets. `erosion.wgsl` is shared today.
- **Not in this card:**
  - maps over 1168 samples, tiles with aprons, stored planes and regional
    exactness of the agents (H5b);
  - shape (H6);
  - progressive levels (H7);
  - blocks on hill rock (an open owner question from H4);
  - every other world.

**Two resolutions** (the card rule). Say both in NOTES.md.
- **The Time pass** runs at the existing grid, 2 px a sample. It writes
  data maps. H2 showed this grid cannot resolve detail of a pixel or two.
- **The marks** are made at 1 px in the engine bake, from the data maps,
  as lit height. Rills, grit, stones and sand grain are all below the grid,
  so they come from the bake, steered by the maps.
- **Fallback:** a 1-px refinement pass, only if the bake cannot make
  convincing rills. Measure its cost before building it.

**Deliver.**

1. **Measure retail first.** This is a stop point.
   - **What to measure.** On green-1..3, measure the weather marks at 1×:
     - drainage streaks, rills and gullies on grass slopes: where they sit
       (slope class, below crests, above faces), and their width, spacing,
       length, darkness and direction against the fall line;
     - debris below faces: stone sizes in px, and how far below the face
       it reaches;
     - bare and sandy patches: where they are, and their share;
     - moss on rock: clump sizes and darkness, against H4's flecks.
   - **Tools.** Start from `measure/slope_texture.py`, `slope_marks.py`,
     `crack_lines.py` and `slope_stats.py`. If they don't measure something,
     add a dev tool under `measure/`.
   - **Engine 1 today.** Take the same numbers on `merge-h4`. Also measure
     the four Time knobs' impact with `measure/impact.py` (usage in its
     docstring). Expect it near 0.
   - **One sheet:** retail crops of each kind of mark at 1× and 2×, beside
     ours.
   - **When to stop.** If the marks are not where this card assumes (for
     example, retail's slope marks are texture that follows no drainage),
     stop and report before building anything. Otherwise record the
     numbers and go on.
2. **The Time pass writes data maps** (GPU, engine 1).
   - **Outputs:** the height, flow (amount and direction), wear (depth
     removed), deposit, talus and wetness. They reach the bake as a texture
     at the pass's resolution; say which format.
   - **Replace the worker.** The apron and sand move into the pass, or
     into placement rules over its maps. Under engine 1 the CPU worker no
     longer runs for Green: no droplets, apron, sand or flow field.
   - Sand may be a placement rule over deposit, flow and slope rather than
     a port of the slab model, if it reads at 1×.
   - **The envelope.** Loosen it under engine 1 enough for erosion to
     show. These stay exact:
     - protected samples (crests, ramp centres and water beds): report the
       largest difference from the authored height over them, which must
       be 0;
     - nothing below the sea changes.

     TNT corners follow the eroded height, as designed. Report the largest
     change per sample, and where it is.
3. **Marks at 1 px in the engine bake**, all as lit height.

   > **Owner, 2026-10-29, after item 1:** "Both". Match retail Green by
   > default, and also build rills, boulders and sand as controls left off
   > for Green.

   **What item 1 found** (b7eecdd, `measure/weather_marks.py`,
   `$R/agent-H5/NOTES.md`):
   - Retail Green's close-up detail is not drainage.
   - **Grass slopes:** the dark lines follow no fall line. Their angles to
     it are spread evenly. Green-2's slope has fine 1-px terrace lines 3-4
     px apart, and soft dark diagonal swaths 20-40 px wide.
   - **Rock:** the only fall-line marks are 1-2 px cracks, 20-60 px long,
     in grey outcrops.
   - **Hills:** grey rock shows through at the rims (green-1).
   - **Faces** meet the grass at a soft mossy edge.
   - **Missing in all three windows:** rills, aprons, fans, boulders and
     sand.

   **3a. Green's retail marks, on by default.** These are driven by the
   data maps, so the Time controls move them:
   - **Terrace lines on grass slopes,** less contour-aligned and broken.
     Green-2's lines are 68% across the fall line today; retail's are 38%.
     Green-1's 0.15-0.4 shaded bin has 19.7 small specks per 1000 px today,
     against retail's 8.6.
   - **Grey outcrops** exposed by wear at hill rims and on steep grass, with
     1-2 px cracks down the fall line, 20-60 px long.
   - **Dark wet swaths** along the flow on grass, 20-40 px wide and soft.
   - **Moss on rock by wetness,** in clumps (`rockMoss`).
   - **The face's foot** stays a soft mossy edge. Grey specks outside the
     rock should come at retail's rate: 1.4-2.0 per 1000 px on green-2, most
     12-30 px from the rock.

   **Measure** with `weather_marks.py`, `slope_marks.py` and the class
   numbers. The bar: closer to retail than `merge-h4` on these numbers, on
   all three windows.

   **3b. Beyond retail, off for Green.** Each is a control at 0 in Green's
   engine values, so Green's default picture doesn't change:
   - **Rills and gullies** along the flow: 1-3 px wide and continuous
     downslope.
   - **Debris:** stones and boulders where talus lies, a few px across,
     with grit between them. They are larger below hard beds, and fans
     spread below the mouths of gullies.
   - **Sand:** fine grain and light ripples where deposit lies.

   Show each turned up on the demo mesa (`repro/demo/mesa-beds.json`) and on
   green-2, at 1× and 2×. Judge by eye, since retail Green has none to
   compare against. Reuse `boulders()` and `debrisStones()` where they fit.

   **Check:** Clay at four suns for both 3a and 3b. The marks must shade
   with the sun.
4. **Controls that matter.** Use `measure/impact.py` (216e59d), which
   judges 16-px blocks and prints a noise floor. The per-pixel measure
   counted texture that only moved a pixel or two over.
   - **Today on `merge-h4`,** as the share of class blocks changed on
     green-1/2/3:

     | Control | Class | Green-1 | Green-2 | Green-3 | Verdict |
     | --- | --- | --- | --- | --- | --- |
     | `erosionAge` | grass slope | 6% | 19% | 8% | modest |
     | `erosionRain` | grass slope | 0.7% | 1.6% | 1.9% | at the floor |
     | `columnContrast` | rock face | 9% | 33% | 4% | |
     | `talusAngle` | grass slope | 1.2% | 0.3% | 0.1% | at the floor |
     | `rockMoss` | rock face | — | 97% | — | |
     | `blocks` | rock face | — | 59% | — | |
     | `blockGrit` | rock face | 0% | 0% | 0% | subtle at 2× |
     | `blockStep` | rock face | about 0 | about 0 | about 0 | subtle at 2× |
   - **The four Time controls** (age, rain, hardness contrast, repose)
     must each reach 5% of their class, clearly above the floor, on
     Green's windows, through 3a's marks. Rain should drive the swaths
     and the wetness, and age the exposure. Repose may move to 3b's debris;
     if so, measure it on the demo with debris on, and say so.
   - **3b's controls** are measured on green-2 and on the demo between 0
     and their maximum.
   - **H4's `blockGrit` and `blockStep`:** strengthen them, or leave them
     at their defaults and take them out of Green's engine values.
   - Add a class to `impact.py` for an area it lacks, such as debris from
     the talus map, or a hill rim.
   - Measure as soon as the marks exist, not only at the end. **Under 5%
     is a finding.**
   - **Overrides:**
     - `ovErosion` scales the pass;
     - `ovDeposits` scales deposit, sand and talus;
     - `ovVegetation` scales the moss.

     Re-run `repro/demo/overrides-green.json`, and show each override's
     effect inside its painted region at 1×.
5. **Map canvases up to 1168 samples.**
   - Green maps run the same GPU pass over the whole map. The CPU worker
     doesn't run for Green under engine 1. Maps over 1168 samples keep the
     tiled worker until H5b; say that in NOTES.md.
   - **Check:**
     - `$R/agent-H5/mapcheck.mjs`: export, TNT corners from the eroded
       height, unique tiles, console;
     - seams at 2× with rock in view;
     - replay mismatch 0;
     - the same scene rendered twice gives the same pixels.
6. **Compare.**
   - **Triptych:** retail | `merge-h4` | after, at 1× and 2×, with crops of
     each kind of mark.
   - **Numbers:**
     - windows and classes (`repro/stats.py`, `measure/material_classes.py`,
       `material_lab.py`);
     - item 1's mark numbers;
     - the face (`$R/agent-H1/face.py`, `$R/agent-H2/runs.py`).
   - **The bar:** at least as close as `merge-h4` on all three windows, and
     closer on grass slopes, where the marks belong.
   - **Times,** alternating, a median of 7: the pass on the study and on a
     4×4 map, the draw, and the bake.

**Judge** by eye first, at 1× and 2× against retail, as decision 11 asks.
Then judge by the numbers, the impact table, the guard (`compare.py ...
--worlds green` against `merge-h4`; `engine=0` reproduces `merge-h4`'s Green
exactly) and the map check.

**Done when** NOTES.md has:
- item 1's retail and engine numbers, with the sheet;
- both resolutions;
- the data maps and the envelope;
- the marks, with four-sun Clay;
- the impact table and its sheets;
- the override check;
- the map check;
- the comparison and the times;
- the guard.

**Order and budget.**
- Item 1, then 2, then 3 with 4's measurements as soon as marks exist,
  then 5 and 6. Each item is its own commit.
- **At most three render-look-change cycles per item** (ground rule 8). H4
  went to about 14 knob-only renders; don't. When an item doesn't
  converge, record what you learned and move on.
- If the budget runs short, stop after any item, with NOTES.md saying what
  remains.

**Server and guard:**
- port 8865, CDP 9665;
- worktree `../terraform-wt-H5`;
- assets `$R/agent-H5`, with `mapcheck.mjs` copied from `$R/agent-H4`;
- baseline `$R/repro-out/merge-h4`;
- guard `--worlds green`.

**Done (merged as ca0c310 after a stop and two rounds; EXPERIMENTS rows
141-144; notes in `$R/agent-H5/NOTES.md`, whose round 2 sections
supersede round 1).**
- **Retail measured first** (`measure/weather_marks.py`). Retail Green's
  close-up detail is not drainage:
  - grass-slope lines follow no fall line;
  - the only fall-line marks are cracks in grey outcrops;
  - no window has rills, aprons, fans, boulders or sand.

  The owner chose both: retail's marks by default, and rills, stones and
  sand as controls left off for Green.
- **The Time pass on the GPU** (engine 1):
  - `engine-erosion.wgsl` steps only the active 8×8 tiles.
  - `engine-weather.wgsl` packs the data maps into `gridTexture` layers 0,
    2 and 3: flow, deposit, talus and sand; wear, wetness, hardness and
    slope; fall line, channel and ridge.
  - It runs at 2 px a sample; the marks are made at 1 px in the bake.
  - Green never runs the CPU worker on the study or on maps up to 1168
    samples.
  - Protected and below-sea samples don't move.
- **Speed.** On a 4×4 map the pass takes 356-415 ms, against the worker's
  1,243 ms. On the study it takes 139-279 ms, against 250-320 ms before.
- **Green's marks:**
  - broken terrace lines (`terraceBreak` 1.4): on green-2, the share of
    lines across the fall line went from 68% to 41% (retail 38%);
  - broad tonal swaths along the flow that keep the mean (`wetSwath`
    .35);
  - outcrops gated by hardness, with cracks notched into the height
    (`outcrop`, 0 for Green: it cost green-1 .009).
- **Beyond retail, off for Green:** `rillDepth`, `stoneDensity` and `sand`.
  The stones are rounded and part-buried, with a lit top and a shadow
  side.
- **Controls that matter** (`measure/impact.py`, 16-px blocks, on the
  shipped build, over sensible ranges):
  - `erosionAge`, `erosionRain`, `wetSwath`, `sand`: 4-34% of grass slope;
  - `columnContrast`: 11 / 22 / 5% of rock face;
  - `rillDepth`, `stoneDensity`: 17-27% on green-1 and green-3;
  - `ovErosion` scales the pass on map canvases too;
  - `ovVegetation` scales moss and exposed rock.
- **Against `merge-h4`** (class Lab):
  - Grass slope: .073 → .068, .032 → .033 and .094 → .086.
  - Rock face: .058 → .061, .047 → .046 and .082 → .084.
- **Merge checks:**
  - Only Green moved against `merge-h4` (mean |diff| 1.83 / 8.43 / 1.47;
    green-2's change is the terrace breakup).
  - All 27 scenes equal the agent's final renders.
  - Replay mismatch is 0, with a clean console, on all 27.
  - `engine=0` Green equals `merge-h3` exactly.
  - The 4×4 export has 1,067 unique tiles, no nearest pixels and a clean
    console.

**Still open:**
- **Green-2's slope is darker.** Its luma mean is 52.6, against `merge-h4`'s
  55.2 and retail's 56.4, from the terrace breakup.
- **The first pass waits on a loaded 4×4 map.** It waits behind about
  6.4 s of GPU work the page queued first (chunk bakes), so weather is
  ready about 6.8 s after load. The worker had no such queue. Run the
  pass before the chunk bakes; bakes made before the weather are redone
  anyway (H7).
- **`talusAngle`** is at the noise floor on Green's default picture. It
  moves only the debris, which is off for Green (8-13% of rock face with
  3b on).
- **`columnContrast`** moves 4.7% of green-3's rock face, just under 5%.
- **The rills** are still broken at 3×, so they stay off.
- **`ovDeposits`** "more" moves 0.8% of its region, because the demo's
  plateau carries little deposit.
- **The draw** costs 23.2 ms on green-2 (H4: 19.0-19.8), +3.5 ms for the map
  reads. That is still under `engine` 0's 29-31 ms.
- **The protected-sample check** is vacuous on green-1..3, which have no
  route or plateau. It holds on the mesa demo (20,182 samples).
- **Not yet deleted:** the CPU worker and its 1,359 lines still serve
  `engine` 0 and other worlds; deletion waits for the slice to be
  accepted.
- **Maps over 1168 samples:** H5b.

### H5b. Weather on large map canvases — outline

Superseded by the full card "H5b. Large maps on the GPU, end to end" below.

- **Coverage.** For maps over 1168 samples: a coarse pass over the whole
  map for drainage, then fine tiles with aprons, so drainage reaches
  across tiles.
- **The flow-bake node pattern:** region, hash, Bake button, stale badge
  and the idle option.
- **Stored planes,** so that regional replay copies them, and export reads
  them and never simulates. They need about seven:
  - the height change, at better than 8 bits (two planes);
  - flow amount and direction (two);
  - wear, deposit or talus, and wetness.

  Planes 14-17 are overrides and 20-24 are flow, so 18, 19 and 25-27 are
  free. Grow the mask from 7 RGBA layers to 9; the design doc names this
  as a bounded change, and its memory cost per chunk on 40×40 maps must be
  reported.
- **Regional exactness** at the final level, by `repro/regional.mjs`.

### H4b. Rock blocks on hill rock (Green)

> **Owner, 2026-10-29,** asked whether H4's blocks should reach hill rock:
> "yes probably".

Read H4's and H5's Done and Still open lists above, and
`$R/agent-H4/NOTES.md` and `$R/agent-H5/NOTES.md`.

**What is there today.**
- **Blocks on big faces only.** `blockField` (`engine-bake.wgsl`) runs only
  inside Green's structured-face gate: painted rock, or slope over
  `rockFrom` 1.6. In these windows that is green-2's face.
- **Green-1 and green-3's rock is small hills,** outside that gate. Every
  block knob moves under 1% of their rock face. Retail's hills show grey
  rock with 1-2 px cracks down the fall line, at their rims (H5 item 1,
  `$R/agent-H5/item1/g1-hillfoot-2x.png`).
- **The `outcrop` control is related.** H5 built it: exposed rock gated
  by the hardness map, with cracks notched into the height. It ships at 0,
  because it cost green-1 .009 rock-face Lab. Hill blocks are the same
  kind of change on the same windows.

**Deliver.**
1. **A gate for hill rock,** separate from the face gate: rock-face slope
   (the rock class, .5 and up) outside the structured face. Don't change
   `rockFrom`: it moves beds and joints elsewhere too.
2. **Blocks there,** sized for hills: smaller and more broken than on the
   big face. One control, `hillBlocks` (0-1), sets the amount.
3. **Judge it with `outcrop`.** Look at the two together on green-1's and
   green-3's hill crops at 2× against retail. Ship the combination that is
   closest. If neither helps, ship both at 0 and report the crops.

**Judge:**
- **By eye** at 1× and 2× against retail, and in Clay at four suns.
- **Rock-face Lab** (`measure/material_lab.py`): at least as close as
  `merge-h5` on all three windows (.061 / .046 / .084). Green-2 must be
  unchanged within noise.
- **Impact** (`measure/impact.py`): `hillBlocks` and the block knobs
  should now move 5% or more of green-1's and green-3's rock face.
- **The guard:** `compare.py ... --worlds green` against `merge-h5`.
  `engine=0` Green is unchanged.
- **The map:** `mapcheck.mjs` export, unique tiles and console.

**Done when** NOTES.md has the crops, the Lab and impact numbers, the
guard and the map check. If hill blocks move green-1 or green-3 away from
retail beyond noise, `hillBlocks` ships at 0. Rule 5 governs, not the
owner's lean.

**Files:** `engine-bake.wgsl` and `engine-common.wgsl`; `sculpt.py`
(`KNOB_DEFAULTS` and Green's `ENGINE_KNOBS`); and in `sculpt-renderer.js`,
only the lines that set H4's block uniforms.

**Budget:** three render-look-change cycles in all.

**Server and guard:**
- port 8866, CDP 9666;
- worktree `../terraform-wt-H4b`;
- assets `$R/agent-H4b`, with `mapcheck.mjs` copied from `$R/agent-H4`;
- baseline `$R/repro-out/merge-h5`;
- guard `--worlds green`.

**Done (merged as cb57320; EXPERIMENTS row 145; notes in
`$R/agent-H4b/NOTES.md`).**
- **The gate.** `hillBlocks` (Green .5) cuts hill rock outside the
  structured face (rock-class slope .35-.65, in patches) into narrow
  pieces, long down the fall line, with .7-px crevices. `rockFrom` is
  unchanged.
- **Rock-face Lab:** .061 / .046 / .084 → .053 / .046 / .084. At 1, green-3
  got worse (.090), so .5 ships. `outcrop` stays 0: with the blocks it cost
  grass-slope Lab on green-1 and green-3.
- **Merge checks:**
  - only Green moved against `merge-h5`;
  - all 27 scenes equal the agent's final renders;
  - `hillBlocks` 0 equals `merge-h5`;
  - `engine=0` Green is unchanged;
  - the 4×4 export is clean.

**Still open:**
- **Faint by eye.** Our hill rock is mostly under grass. Retail's grey
  outcrops with crisp black cracks need the draw's rock exposure
  (`place.exposed` in `engine-frag.wgsl`) and a height notch for the
  cracks. Both are outside this card's files.
- **Impact is borderline.** `hillBlocks` 0 → .5 moves 6.6 / 4.9% of
  green-1's and green-3's rock face; green-3 is under its floor. On the
  hills, `blockRow`, `blockWidth`, `blockStep`, `blockChip` and
  `blockGrit` move under 5%.

### H7. Progressive rendering on the Green slice

> **Owner, 2026-10-29:** "Now that we're on the GPU let's do H7
> progressive rendering." Fast progressive rendering is one of the three
> things the owner wants most (decision 4).

Read [docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md) "Progressive
rendering" and "Rules for the cards", and H5's Done and Still open lists
above. Then read Card D phase 3's Done list (search "Phase 3"), which
built the map canvas this card reschedules.

**What is there today.**
- **The map canvas** (`sculpt-canvas.js`):
  - a 128×128 coarse overview;
  - full-resolution chunk images baked on demand for the visible chunks
    and one margin, held in an LRU (`sculpt-chunk-renderer.js`).
- **`quality: 'preview'`** exists in the renderer. It is a cheaper draw at
  the same resolution (a 192 mesh, fewer shadow taps), not a
  lower-resolution level.
- **Weather.** Green's Time pass (H5) runs on the GPU over the whole map
  up to 1168 samples: 0.36-0.42 s on a 4×4 map. Larger maps keep the
  tiled CPU worker (H5b).
- **The queue.** On a freshly loaded 4×4 map, the first Time pass waits
  behind about 6.4 s of chunk bakes queued before it, so weather is ready
  about 6.8 s after load. The bakes made before the weather are redone.
- **Old numbers:** Card D measured a scroll p95 of about 117 ms and about
  2 s of refinement after a stroke's release. That was before H4 and H5
  changed the draw and the weather.

**Scope.**
- The map canvas and the 1024-px study, for Green's engine.
- Scheduling, levels and what runs when. **No change to any final
  pixel:** the shaders and `sculpt.py` are not this card's files.
- Other worlds take the same scheduling, and their final pictures must
  not change either.

**Deliver.**

1. **Measure first.** This is a stop point: hand back the numbers before
   building levels.
   - **A dev tool,** `repro/perf.mjs`. It loads a scene on a map canvas
     headless and scripts these, writing JSON:
     - the load: time to the first picture, to weather ready, and to every
       visible chunk at final;
     - a stroke drag: frame times;
     - the release: time to final in view;
     - a scroll: frame times, and time to final after it stops;
     - an export: its time.
   - **Split the time** between shape replay (JS), field upload, the Time
     pass (GPU), chunk bakes, the draw, readbacks and GPU queue wait.
     Use the renderer's timestamp queries.
   - **Run it on** a 4×4 Green map (mapcheck's scene) and an 8×8 Green
     map, which takes the CPU worker. Run the study as well.
   - **Report the baseline** and stop.
   > **After item 1** (`repro/perf.mjs`, 8318d74): the map canvas is bound
   > by the main thread, not the GPU.
   > - **The sampler.** The JS field sampler costs 0.21 ms a call.
   >   `drawCoarse` (the 128² overview) and `drawMapBounds` (the edge
   >   outline, redrawn in every `overlays()`) make 54k calls on a 4×4 load:
   >   11.7 s, including one 6.65 s block.
   > - **H5's "6.4 s queue wait"** was that block.
   > - **The GPU** is idle about 99% of the time. Each chunk bake is about
   >   290 ms, of which 233 ms is the CPU packing loop in `upload`.
   > - **Every drag frame redraws the overview:** p95 3.1 s on 4×4 and
   >   7.7 s on 8×8.
   > - **The study already meets every target.**
   >
   > **So item 2 becomes main-thread time first:**
   > - sample the overview and the edge outline once per revision, and
   >   update them only over dirty rectangles;
   > - slice whatever sampling remains so no frame blocks;
   > - then the order fix;
   > - then an exact-output speedup of the `upload` packing loop.
   >
   > Each is measured on its own. `sculpt-map.js` (`drawMapBounds`) and
   > `sculpt-fields.js` join the card's files, as long as every sampled
   > value is unchanged. Quarter levels (item 3) pay off mainly by cutting
   > the upload loop. The 4.3 s scene replay before the Time pass is shape
   > replay: it belongs to H6, not this card.

2. **Order the work.**
   - The Time pass is submitted before any chunk bake that reads its
     height.
   - A queued bake is dropped when the scene changes under it (the
     canvas's epoch), so stale work never runs.
   - This fixes H5's 6.8 s, and it is probably the biggest single win.
     Measure it on its own.
3. **Levels.** These are overview (the existing 128²), quarter and final.
   - **Quarter** means a chunk baked at a quarter of its resolution and
     drawn scaled, not the `preview` draw. Every stage is defined in world
     units, and the materials have H4's footprint mips for this.
   - **State the resolution rule for each stage** at quarter (the card
     rule): the Time pass, the bake and the material level.
   - **Show one chunk at quarter and final, side by side.** It must be
     recognisably the same picture.
   - **Order of refinement:** visible chunks first, then the margin, then
     the rest when idle.
   - **A debug overlay** marks each chunk's level.
   - **Memory:** report what the quarter images cost against the budgets.
4. **While dragging and after release:**
   - **While dragging:**
     - shape updates live;
     - the Time pass keeps its last result under the stale badge;
     - only the dirty chunks redraw, at quarter or with the fast draw.
   - **On release:** the Time pass runs, then the visible chunks refine
     to final, then the rest.
   - **The study** takes the same order where it applies.
5. **Targets,** set against item 1's baseline, not as absolutes:
   - time to final in view, after load and after release: at most half
     the baseline;
   - drag frame p95: under 33 ms, or under the baseline if that is already
     lower;
   - scroll: something is always on screen. Report the p95, and the time
     to final after scrolling stops.

**Exactness** (a done-when, not a nice-to-have). The final level must be
unchanged:
- `compare.py ... --worlds none` against the baseline renders: all 27
  study scenes exact;
- the 4×4 export: TNT bytes and the indexed PNG's hash identical to the
  same export on the baseline;
- `repro/regional.mjs` on the scenes it covers: 0 mismatches.

The quarter and overview levels may differ; export waits for final.

**Done when** NOTES.md has:
- item 1's baseline;
- the order fix measured on its own;
- the levels with their resolution rules and the side-by-side;
- the targets met, or by how much they were missed;
- memory;
- the exactness checks.

**Files:** `sculpt-canvas.js`, `sculpt-chunk-renderer.js`, the scheduling
in `sculpt-renderer.js`, the submission order in `sculpt-erosion.js`,
`sculpt-map-weather.js`, the study's scheduling in `sculpt.js`, and the
new `repro/perf.mjs`. Not any `.wgsl` file, and not `sculpt.py`.

**Budget:**
- Item 1 is a stop point.
- After it, items 2-4 are each their own commit.
- If the budget runs short, stop after item 2 with NOTES.md saying what
  remains. Item 2 alone is worth landing.

**Server and guard:**
- port 8867, CDP 9667;
- worktree `../terraform-wt-H7`;
- assets `$R/agent-H7`, with `mapcheck.mjs` copied from `$R/agent-H4`;
- baseline `$R/repro-out/merge-h4b` (H4b's merge; until then,
  `merge-h5`);
- guard `--worlds none`.

**Done (merged as 1fffe4f; EXPERIMENTS row 146; notes in
`$R/agent-H7/NOTES.md`).** No final pixel changed.
- **Item 1, the baseline** (`repro/perf.mjs`): see the note under item 1.
- **2a, sampling once per revision.**
  - `sculpt-fields.js` keeps each node's reach and each sampled point
    until the next edit.
  - `sculpt-canvas.js` samples the 128² overview only over an edit's
    dirty rectangle, in slices (a 32² lattice first), and not at all
    during a drag.
  - Field sampling on a 4×4 load went from 11.7 to 0.45 s.
- **2b, order.**
  - While the Time pass is pending, the canvas paints cached chunks and
    bakes none, for at most 8 s.
  - A bake whose scene changed while it waited for its fields is
    dropped before it reaches the GPU.
  - Alone it is worth only 0.2-0.3 s, because 2a had already removed the
    wait.
- **2c, upload.** The packing loop in `ChunkTerrainRenderer.upload` looks
  each plane up once. It went from 233 to 125 ms a chunk, with the same
  bytes.
- **Results** (seconds unless marked; single runs on a shared host):

  | | 4×4 before | 4×4 after | 8×8 before | 8×8 after |
  | --- | --- | --- | --- | --- |
  | Load, visible chunks final | 19.1 | 7.2 | 33.2 | 16.2 |
  | Release, visible chunks final | 12.9 | 2.1 | 26.4 | 7.5 |
  | Scroll rAF p95 | 1300 ms | 16.8 ms | 3050 ms | 50 ms |
  | Drag rAF p95 | 3133 ms | 350 ms | 7666 ms | 283 ms |
  | Export | 7.5 | 4.6 | 25.5 | 16.0 |

  The study already met every target and is unchanged.
- **Merge checks:**
  - all 27 scenes are exact against `merge-h4b`;
  - replay mismatch is 0;
  - `regional.mjs` finds 0 mismatches in all 31 planes on all 27 scenes;
  - the 4×4 export's indexed PNG hash is identical, and the .ufo has
    the same size, differing only in the 12 bytes of the map name;
  - my own `perf.mjs` run on 8801, at load 4.5, gave load 7.9 s,
    release 2.25 s, scroll p95 16.8 ms and drag p95 367 ms.
- `perf.mjs` now exits once it has written its JSON; before, it hung.

**Still open:**
- **Drag p95 misses 33 ms.** It is 350-367 ms on 4×4 and 283 ms on 8×8.
  Each pointer move costs:
  - about 160 ms of shape replay, which is H6's;
  - about 150 ms of full-resolution upload;
  - the map outline. `drawMapBounds` re-samples the whole edge on every
    move, because the memo is cleared each revision: 328k calls, 4.8 s
    over a 34 s drag.

  Skipping the outline during a gesture, or updating it by dirty
  rectangle, is a cheap next step. The rest needs H6 and quarter levels.
- **Item 3 (quarter levels) was not done.** The shaders read baked
  fields one texel per world pixel (`chunkFieldsOrigin` and
  `chunkFieldsSize` in `sculpt-common.wgsl`), so a quarter bake needs
  WGSL changes outside this card's files.
- **Scene replay** takes 4.3 s on 4×4 and 6.5 s on 8×8 (H6). On 8×8,
  tile weather adds about 7.5 s to load.
- **The 2b hold** uses `canExport()` as its "weather pending" signal,
  but that is also false while loading or during a flow bake. The 8 s
  cap bounds it. An explicit weather-pending call in `sculpt.js` would
  be cleaner.
- **Memory.** Peak heap on 4×4 rose from 508 to 558 MB because of the
  sample memo, which is capped at 200k entries. GPU memory is unchanged.

### H6. Shape on the GPU (Green)

> **Owner, 2026-10-29:** "Okay do H6 next." It serves decision 4
> (everything on the GPU) and removes two costs H7 left. A 4×4 scene
> replays its shapes for 4.3 s on load. Each drag move spends about 160 ms
> replaying the dirty chunk.

Read [docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md) "The Green slice",
"Rules for the cards" and the H6 outline under Cards. Then read H7's Done
and Still open lists above.

**What is there today.**
- **The shape engine** is JS in `sculpt.js`. `replayNode` and
  `replayShape` apply each node in order to the fields the nodes before
  it left, through `dab`, `sweep`, `settleHill`, the sections,
  `applyCracks`, mask painting, and `groundHeight` for the ground node.
- **It writes 31 planes** (`FIELD_KEYS`): `h`, `p`, `r`, `c`, `v`, `x` and
  the 25 mask planes.
- **The study** (1024 px) replays the whole grid into `heights`, the masks
  and the rest, then uploads them.
- **Maps** use `createRegionalFields` (`sculpt-fields.js`):
  - 256-cell prefix tiles, each node replayed over its apron on the
    tiles before it, and cached;
  - `read()` crops a window;
  - `sample()` reads a point, through H7's memo.
- **Green's windows** (green-1..3, 23 strokes) use hill ×6, mountain ×1,
  deep ×4, erase ×1 and paint ×11, plus the ground node. With Green's
  knobs, `fingerCoast`, `shoreLayers`, `shorePlates`, `hillLobes` and
  `iceFacets` are 0. So the coast pass and its connectivity flood should
  not run; item 1 confirms it.

**Scope.**
- **Green's kinds as compute passes** in a new `engine-shape.wgsl`,
  beside the JS engine.
- **Behind a new knob,** `gpuShape`: 0 is JS, 1 is GPU. It is separate
  from `engine`, so the two can be compared on engine 1.
- **Whole-map fields on the GPU** for the study, and for maps up to 1168
  samples (H5's bound). Larger maps keep the JS engine until H5b.
- **Fallback.** A scene with any node kind the GPU does not take falls
  back to the JS engine as a whole, and the status line says so.
- **Not this card (H6b):** feeding chunk bakes and the Time pass straight
  from the GPU fields, without the CPU copy and the per-chunk upload.
  Here the existing consumers read a CPU copy.

**Deliver.**

1. **The inventory. This is a stop point.** Instrument `replayShape` and
   `replayNode` on green-1..3 (the study) and on mapcheck's 4×4 scene.
   Hand back:
   - **Per kind, what actually runs** with Green's knobs and the `evad`
     variant:
     - confirm that the coast pass, shore plates, hill lobes and ice
       facets are off;
     - say whether hills and mountains take `settleHill` or `sweep`;
     - say whether `ridgeOn` is true (`spurCount`, `crestJag`,
       `crestVary`, `crestTaper`).
   - **Every non-local step:**
     - the radius of each `blurred` and `blurredBox`;
     - `sweepDistance`;
     - point reads of earlier shapes (`prefixPoint`);
     - global bounds;
     - anything else that reads beyond its own cell.
   - **The noise and precision:**
     - the noise each kind uses (`NOISE_FIELDS`, `makeNoise`,
       `framedNoise`, `hash` and `valueNoise`);
     - every spot sensitive to float precision: `Math.hypot`, long sums,
       a `floor` of a scaled coordinate.

     The fields are already stored as `Float32Array`, and the regional
     paths already `Math.fround`.
   - **Which planes each kind writes.**
   - **Cost and size:** the JS lines to port per kind, and the time each
     kind costs today, on the study, on the 4×4 load and on one drag move.
   - **A flag on hill and mountain.** Say so explicitly if their path
     (`settleHill`, the ridge pieces) is several hundred lines of
     data-dependent path walking. Hill and mountain may then become a card
     of their own.
   - **The proposed passes per kind:** the dispatch shape, what each reads
     and writes, and the resolution each runs at.

2. **The GPU fields, and the simplest kinds.**
   - **One interface.** A new `sculpt-gpu-fields.js` returns the same
     object as `createRegionalFields`: `read`, `readCells`, `sample`,
     `changed`, `clear`, `revision`, and the stats the canvas reads. Then
     `sculpt-canvas.js`, export, features and H7's memo work unchanged.
     The switch is the one call in `makeRegionalFields`, plus its
     equivalent for the study.
   - **The live stroke.**
     - A committed prefix holds the fields after nodes 0..N-1, and the
       live node renders into a working copy on each move.
     - `changed(rect, keepPrefix)` maps onto it. An append, or a preview
       of the last node, re-runs only that node over its bounds.
     - An edit re-runs that node and every later node over the dirty
       rectangle, with each node's apron.
   - **The CPU copy never blocks a frame.**
     - During a gesture, only the dirty rectangle is read back,
       asynchronously. A bake that needs it waits for it; the frame does
       not.
     - The whole copy refreshes on release, and before export, regional
       checks and anything else that must be final.
     - During a gesture, `sample()` may return the value from before the
       stroke, as H7's overview already does.
   - **Kinds:** paint and erase first (they are stamps), then the ground
     node. One commit each.
   - **A check tool,** `repro/shapecheck.mjs`, compares JS with GPU per
     scene and per plane:
     - the max |Δ|;
     - the share of cells over 0.01, 0.5 and 1 height unit (for masks,
       over 0 and over 1 step);
     - the GPU run twice on one machine, which must be identical.

3. **Deep, then hill and mountain.** One commit each, in the order the
   inventory finds simplest.

4. **Measure** with `repro/perf.mjs` on the 4×4 map and the study. The
   8×8 map is over 1168 samples, so it stays on JS.
   - Scene replay on load: from 4.3 s to well under 1 s on 4×4.
   - The shape share of one drag move: from about 160 ms to under 10 ms.
   - The study: load, and drag frame times.
   - **Drag p95 will still miss 33 ms.** The per-chunk upload (about
     150 ms) stays until H6b, and the outline needs the cheap fix in H7's
     Still open. Report what remains.

5. **Resolution** (the card rule). Each pass states its sample spacing.
   Show green-2 evaluated at a quarter of the grid and at final, side by
   side. They must be recognisably the same picture.

**Acceptance.**
- **Heights:** `shapecheck.mjs` on green-1..3 and the 4×4 scene. The
  numbers are reported, not required to be zero: expect f32 differences.
  List each cluster over 0.5 unit and its cause.
- **Renders:**
  - compare green-1..3 at `gpuShape` 1 with `merge-h7` using
    `measure/impact.py <name> $R/repro-out/merge-h7 <yours>`. Changed
    blocks must be at or under the shift floor in every class;
  - by eye at 1× and 2×, using the crop sheets, it is the same picture.
- **Retail:** `measure/material_lab.py` no worse than `merge-h7` on any
  window or class:

  | Class | green-1 | green-2 | green-3 |
  | --- | --- | --- | --- |
  | Flat | .007 | .017 | .010 |
  | Grass slope | .069 | .033 | .087 |
  | Rock face | .053 | .046 | .084 |
- **Everything else stays exact,** at `gpuShape` 0:
  - `compare.py $R/repro-out/merge-h7 <yours> --worlds none`: all 27
    scenes exact;
  - the 4×4 export is identical to `$R/exports/H2Check8801x77804*` apart
    from the name;
  - `regional.mjs` finds 0 mismatches on all 27 scenes.
- **Regional exactness for Green under the GPU shape is dropped, and
  recorded as dropped.**
  - Whole-map evaluation replaces regional replay, and a window is a crop
    of the whole map.
  - Under `gpuShape` 1, `regionalCheck()` checks instead that a fresh
    whole-map GPU evaluation, read back, equals the CPU copy, and that
    windows equal crops.
  - Say what `render.mjs`'s `mismatch` field means for those scenes.
- **The 4×4 export at `gpuShape` 1:**
  - its self-check passes;
  - its TNT heights are compared with the JS export: the max difference,
    and the share over 1 unit;
  - two exports are identical.
- **At acceptance,** Green's `gpuShape` default becomes 1 in
  `ENGINE_KNOBS`. The guard for that run is `--worlds green` against
  `merge-h7`, and the other 24 scenes stay exact.
- **The retire rule is suspended** for the slice (decision 10), so the JS
  engine stays. Report the size of what the GPU path would replace (JS
  lines per kind) beside the new WGSL and JS.

**Done when** NOTES.md has:
- the inventory;
- per kind, the `shapecheck.mjs` numbers;
- the block comparison and the crop sheets;
- Lab;
- the performance numbers against H7's;
- the quarter and final side by side;
- the exactness checks;
- memory: the GPU bytes for the whole-map fields at 1168 samples.

**Files:**
- New: `engine-shape.wgsl`, `sculpt-gpu-fields.js` and
  `repro/shapecheck.mjs`.
- `sculpt.js`, only at the seam: `makeRegionalFields`, the study's replay
  entry, reading the knob, the status line, and `regionalCheck`.
- `sculpt.py`, for the knob: default 0, and Green 1 at acceptance.
- Not the chunk renderer, the Time pass (`sculpt-erosion.js`,
  `sculpt-map-weather.js`), `sculpt-canvas.js`, or any draw or bake
  shader.

**Budget:**
- Item 1 is a stop point.
- After it, each kind is its own commit.
- If the budget runs short, stop after the kinds that are done. NOTES.md
  then says which scenes still fall back.

**Server and guard:**
- port 8868, CDP 9668;
- worktree `../terraform-wt-H6`;
- assets `$R/agent-H6`, with `mapcheck.mjs` copied from `$R/agent-H4`;
- baseline `$R/repro-out/merge-h7`;
- guard `--worlds none` at `gpuShape` 0 until acceptance, then
  `--worlds green`.

**Done (merged as 48818aa; EXPERIMENTS row 147; notes in
`$R/agent-H6/NOTES.md`).**
- **The inventory (item 1).** With Green's knobs the ridge, spur, coast,
  plate, lobe and facet code never runs.
  - A hill is about 130 lines: sections, plus two box blurs of radius 2.
  - A mountain is a chain of dabs.
  - The 4×4 load's 4.3 s came from replaying the same nodes in many
    windows, not from the arithmetic: 262 window replays and 103 noise
    builds for green-2.
- **What landed:**
  - **`engine-shape.wgsl`** (333 lines) has noise (framed through the
    inverse frame), stamp, hill section, blur, compose, ground and pack
    passes. Each node is one chain of dispatches, in node order.
  - **`sculpt-gpu-fields.js`** (460 lines) has the shape engine and
    `createGpuFields`. That is the `createRegionalFields` interface over
    one whole-map evaluation, with the JS fields as the whole-scene
    fallback, for maps up to 1168 samples.
  - **The study** evaluates on the GPU and reads the result back into its
    live planes. Export and weather wait for the copy.
  - **Kinds on the GPU:** paint, erase, deep, shallow, mountain, hill
    (point, span and settled) and the ground node. Anything else, or an
    exotic option, runs the whole scene on JS, and the status line says
    why.
  - **The knob** `gpuShape`: 0 is JS and 1 is GPU. Green sets 1 in
    `ENGINE_KNOBS`.
  - **Check tools:** `repro/shapecheck.mjs` and
    `repro/shape-scenes/green-shallow.json`.
- **Review fix (1a1a85f).** The GPU fields told the canvas of a change
  before the CPU copy held it. So the minimap was flat on a fresh load
  (green-2's hill was missing), and it stayed one edit behind after each
  edit. Now the listeners hear of a change when the copy lands, and the
  minimap equals the JS engine's pixel for pixel.
- **GPU against JS** (`shapecheck.mjs`, on green-1..3, green-shallow and
  the 4×4 map):
  - max |Δh| is 0.0002-0.0005, and no cell is over .01;
  - masks differ only by one step, on 8-10 cells (rounding at f32);
  - GPU runs repeat bit for bit.
- **Renders:**
  - green-1..3 change on 193, 248 and 216 of 1,048,576 pixels, isolated
    single pixels where a material threshold flips;
  - `impact.py` shows 0.0% changed blocks in every class;
  - Lab is identical to `merge-h7` on all nine;
  - by eye at 4×, it is the same picture.
- **The 4×4 export:**
  - TNT heights, features and tile indices are identical to the JS
    export, and 265 of 4.5M tile pixels differ;
  - the self-check passes;
  - at `gpuShape` 0 the export equals `H2Check8801x77804` apart from the
    name.
- **Regional exactness for Green is dropped, and recorded as dropped.**
  Whole-map evaluation replaces regional replay. Under `gpuShape` 1,
  `regionalCheck()` checks that a fresh evaluation equals the CPU copy and
  that each quadrant equals the whole: 0 mismatches on green-1..3.
  `render.mjs`'s `mismatch` is trivially 0 for those scenes;
  `shapecheck.mjs` is the real comparison.
- **Merge checks:**
  - the 24 non-Green scenes are exact against `merge-h7`;
  - Green at `gpuShape` 0 is pixel-identical to `merge-h7`;
  - the merged renders equal the agent's;
  - `regional.mjs` finds 0 mismatches on all 27 scenes (Green's through
    the GPU check).
- **Performance** (4×4 green-2, `perf.mjs`; for H6, the agent's run and
  mine on 8801):

  | | H7 | H6 |
  | --- | --- | --- |
  | Load, visible chunks final | 7.2-7.9 s | 2.65 / 2.6 s |
  | Weather ready on load | 5.5 s | 0.67 / 0.66 s |
  | Drag rAF p95 | 350-367 ms | 167 / 183 ms |
  | After release, chunks final | 2.1-2.25 s | 2.15 / 2.23 s |
  | Scroll p95 | 16.8 ms | 16.8 ms |

  - The whole-map shape evaluation takes about 31 ms for 1.36M cells and
    25 passes, including the readback of all 31 planes.
  - The shape share of one drag move fell from about 160 ms to 7-9 ms for
    a small node, about 18 ms for the erase node, and 25-36 ms for the
    largest.
  - The study (512²) loads in 0.90 s, from 1.28 s, and is final after
    release in 0.43 s, from 0.58 s.
- **Resolution.** green-2 at a quarter of the cells (257²) beside final
  (512²) is the same picture: mean |Δh| .09, p95 .35, max 1.25. The hill
  blur is 2 final cells in world units, which is 1 cell at double
  spacing. The side-by-side is `$R/agent-H6/out/levels-green-2.png`.
- **Memory at 1168²:**
  - 71 MB of persistent GPU (planes 32.7 MB, masks 38.2 MB);
  - noise 38 MB and scratch 16 MB, transient;
  - a peak of 259 MB;
  - a CPU copy of 67 MB.
- **Size.** 333 lines of WGSL, 460 of JS and 105 at the seam, replacing
  about 430 lines of JS for Green's kinds. The JS engine stays
  (decision 10).

**Still open:**
- **Drag p95 is 167-183 ms.** The cost is now the per-chunk upload (156 ms
  a chunk during a drag) and the chunk bakes: H6b.
- **After release, 2.2 s is unchanged.** It is chunk bakes and uploads:
  H6b.
- **The committed prefix is not built.** Each move re-runs every node over
  the dirty rectangle and reads it back, so large nodes take 25-36 ms. A
  prefix copy (about 70 MB at 1168²) would re-run only the moved node and
  the ones after it.
- **The study's live stroke is still JS.** The JS engine draws a new
  stroke on the live arrays, and the GPU re-evaluates it afterwards. Drag
  p95 is 16.7 ms either way.
- **Reads wait for every queued run.** During a fast drag, a bake can wait
  across several runs. Coalescing queued runs would bound this.
- **The canvas's GPU budget** (`fixedGPU()` in `sculpt-canvas.js`) does
  not count the GPU fields (71 MB, peak 259 MB). Fold it in with H6b.
- **Fallbacks:**
  - plateau, offset, lower and crater still fall back; plateau, crater
    and ramp read points of the prefix;
  - so do exotic options;
  - maps over 1168 samples stay on JS (H5b).
- **Scene load still builds a JS probe stroke per node** to get its
  parameters, about 65 ms a seed on the study.

### H6b. The map canvas fed from the GPU fields (Green)

> **Owner, 2026-10-29:** "Keep going", after H6. This finishes what H6
> started for the map canvas: no CPU stage on the path from a pointer move
> to the pixels, and a drag under 33 ms (H7's target).

Read H6's and H7's Done and Still open lists above, then the H6 and H6b
outlines in [docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md#cards).

**What is there today** (4×4 Green, `gpuShape` 1, after H6):
- **The fields.** The whole-map shape fields live in GPU buffers
  (`sculpt-gpu-fields.js`), and everything reads a CPU copy of them. The
  copy is refreshed after every evaluation, including during a drag.
- **The Time pass** (`sculpt-erosion.js`, through `queueWeather` in
  `sculpt.js`):
  - `globalWeatherInput()` reads h, p and the erosion override out of
    that CPU copy;
  - the pass runs on the GPU and reads its height and the three packed
    maps back into `refined` and `regionalWeather`.
- **Each chunk bake:**
  - `readRegional` crops the CPU copy, blends in the weather
    (`(refined − base) × (1 − smooth(0, 10, |h − base|)) × (1 − r)`), and
    unpacks the maps;
  - `ChunkTerrainRenderer.upload` then packs every plane and writes the
    chunk textures.
- **A drag** costs about 19 ms of shape read and **156 ms of upload per
  chunk**, all on the main thread: drag p95 is 167-183 ms. After release,
  chunks are final in 2.2 s, and the load takes 2.6 s.
- **One device.** In map mode, `renderer` is the chunk renderer, so the
  GPU fields, the Time pass and the chunk bakes already share a device.

**Scope.**
- The map canvas, where the GPU fields are active: `gpuShape` 1, up to
  1168 samples, no fallback. The study is not in scope.
- **Every other case keeps today's CPU path, unchanged:**
  - other worlds;
  - `gpuShape` 0;
  - fallback scenes;
  - maps over 1168 samples.
- **A query switch, `gpuFeed`** (default 1), turns the new path off for
  A/B. No knob is needed in `sculpt.py`.

**Deliver.**

1. **The Time pass on GPU buffers.**
   - Its input (h, p, and the erosion override as a rate) comes from the
     GPU fields' buffers, not from `globalWeatherInput()`.
   - Its output (height and the three maps) stays in GPU buffers.
   - `refined` and `regionalWeather` are read back only when a CPU reader
     needs them, and never on the bake or drag path. The readers that do:
     - `sampleRegional`;
     - features and picking;
     - export (`sampleHeights`, TNT corners);
     - `regionalCheck`.
2. **Chunk bakes from GPU buffers.**
   - **A compute pass** (a new `engine-feed.wgsl`) builds a chunk's
     height, routes, grid layers and mask textures from the whole-map
     buffers. It does the same arithmetic as `readRegional` plus `upload`,
     in f32:
     - the weather blend;
     - the `exportArt` clamp;
     - `toByte` as `floor(v × 255 + .5)` after the clamp;
     - the mask packing;
     - the `painted` flags.

     The flags may come from a small reduction, or from the fields'
     own record of which planes are non-zero.
   - `sculpt-canvas.js` chooses this path when the fields offer it.
     `ChunkTerrainRenderer` keeps `upload` for every other case.
   - **Measure** the per-chunk cost and the load, release and drag
     figures with `perf.mjs`.
   - **This is a stop point:** hand back with the numbers before item 3.
3. **The drag path.**
   - **A committed prefix.** These are the fields after every node before
     the moved or live one. A move re-runs only that node and the nodes
     after it, over the dirty rectangle. Measure small and large nodes:
     H6 measured 7-9 ms and 25-36 ms. Keep it only if it helps, and say
     what it costs in memory.
   - **Coalescing.** A queued run that has not started takes the union
     rectangle and the newest node list, so a bake never waits behind a
     chain of runs.
   - **No CPU readback during a gesture.** The copy refreshes on release.
     The minimap and the overview must still update after the release.
     H6's review found them flat when a change was announced before the
     copy held it.
4. **Memory.**
   - `fixedGPU()` in `sculpt-canvas.js` counts the GPU fields, the Time
     pass's buffers and the prefix (H6 left 71 MB, peak 259 MB, uncounted).
   - Report the totals against the 512 MB default budget.
5. **Targets** (4×4 Green, `perf.mjs map4`):
   - drag rAF p95 under 33 ms;
   - after release, visible chunks final in at most 1.0 s (from 2.2 s);
   - load, visible chunks final in at most 1.5 s (from 2.6 s);
   - scroll p95 unchanged;
   - export no slower.

**Exactness and acceptance:**
- **The study is untouched.** `compare.py $R/repro-out/merge-h6 <yours>
  --worlds none` must be exact on all 27 scenes.
- **The CPU path is unchanged.**
  - The 4×4 export at `gpuShape=0` must be identical to
    `$R/exports/H2Check8801x40251.ufo` apart from the name.
  - At `gpuFeed=0` it must be identical to
    `$R/exports/H2Check8801x23093.ufo` (`gpuShape` 1) apart from the
    name.
- **The GPU feed** (default):
  - **Export heights:** the TNT heights, features and tile indices are
    identical to `H2Check8801x23093`. Report how many tile pixels differ.
  - **The 1× view** (mapcheck's `view.png`) at `gpuFeed` 1 against 0:
    changed 16-px blocks are at or under the shift floor, and by eye it is
    the same picture.
  - **The minimap** after load and after an edit equals `gpuFeed` 0, using
    `$R/navcheck.mjs` (usage in its first line).
  - **`regional.mjs`** finds 0 mismatches on all 27 scenes.
- **A TNT height comparer** is in `$R/tntheights.py`
  (`tntheights.py a.ufo b.ufo`).

**Done when** NOTES.md has:
- each item measured on its own;
- the targets met, or by how much they were missed;
- memory;
- every exactness check above.

**Files:**
- New: `engine-feed.wgsl`.
- `sculpt-gpu-fields.js`: expose buffers, the prefix, coalescing, the
  readback policy.
- `sculpt-erosion.js`: GPU input and output buffers, lazy readback.
- `sculpt-chunk-renderer.js`: the GPU feed beside `upload`.
- `sculpt-canvas.js`: the bake's choice and `fixedGPU()`.
- `sculpt.js`, only at the seams: the map's weather glue,
  `readRegional`, `sampleRegional`, `canExport`.
- Not any draw or bake shader (`engine-frag`, `engine-bake`,
  `engine-common`, `sculpt-*.wgsl`), not `sculpt.py`, and not the study
  path.

**Budget:**
- Item 2 is a stop point.
- After it, each item is its own commit.
- If the budget runs short, stop after item 2. It is the biggest single
  win.

**Server and guard:**
- port 8869, CDP 9669;
- worktree `../terraform-wt-H6b`;
- assets `$R/agent-H6b`, with `mapcheck.mjs` copied from `$R/agent-H4`;
- baseline `$R/repro-out/merge-h6`;
- guard `--worlds none`.

**Done (merged as 1fec3ce; EXPERIMENTS row 148; notes in
`$R/agent-H6b/NOTES.md`).**
- **The Time pass on GPU buffers (item 1).**
  - `GpuErosion.runGpu` reads h, p and the erosion override straight from
    the GPU fields' buffers. Passes in `engine-feed.wgsl` build the erosion
    state, the fixed field and the active-tile list, with atomics and an
    indirect dispatch.
  - The result stays in two GPU buffers: the authored and eroded height,
    and the three packed maps.
  - The height is read back once when a result lands outside a gesture,
    because picking and the cursor read heights at once. The maps are read
    only when a CPU reader asks: export, or the CPU bake path.
- **Chunk bakes from GPU buffers (item 2).**
  - `feedMain` builds a chunk's height, route, grid-layer and mask
    textures in about 0.6 ms of GPU time. The painted flags come from one
    OR-reduced word.
  - A chunk costs 37 ms on load, from 185 ms.
  - Fed cache entries keep no height patch.
- **The drag path (item 3).**
  - **Two readinesses.** `gpuReady` means every requested run has been
    submitted, and fed bakes wait on it. `ready` still means the CPU copy
    has landed; CPU readers, the overview, the minimap and saving wait on
    that, as in 1a1a85f.
  - **No shape readback during a gesture.** One read of everything the
    gesture changed runs on release.
  - **Coalescing.** At most two runs are unfinished. Later requests merge
    into one waiting run with the union rectangle.
  - **The canvas keeps** a bake whose input no later change touched. It
    shows a finished bake that a later move touched, but does not cache
    it.
  - **`perf.mjs` drag** reports the latency from a move to the first
    presented chunk carrying it.
  - **The prefix was not built.** The shape run's GPU time is 2.6-3.6 ms
    of about 50 ms latency; most of the rest is waiting behind earlier
    bakes in the queue. A prefix would cost 70.9 MB at 1168².
- **Memory (item 4).**
  - `fixedGPU()` counts the GPU fields, the live weather buffers, retired
    ones still leased by a bake, and 120 B a cell while the Time pass
    runs.
  - The Time pass waits for the shape runs' GPU work before it allocates.
  - A bake leases the weather buffers until its feed pass is submitted, so
    a replaced result is destroyed then, not on a timer.
- **Review fixes.**
  - A CPU Time pass now drops the GPU result. Before, a fallback scene
    (adding a plateau) could read back the stale pre-plateau weather. That
    sequence, then undo, exports the same TNT as at `gpuFeed=0`.
  - The eager height readback above.
- **Exactness** (my merge checks, on 8801):
  - the 27 study scenes are exact against `merge-h6` and equal the
    agent's renders; Lab identical; `regional.mjs` 0 on all 27;
  - the 4×4 exports at `gpuFeed=0` and `gpuShape=0` are byte-identical to
    `H2Check8801x23093` and `H2Check8801x40251` apart from the name;
  - at `gpuFeed` 1, TNT heights, features and tile indices are identical,
    and 23 of 4.5M tile pixels differ (the f32 Time pass);
  - the 1× view differs only in the status text's timing;
  - the minimap equals `gpuFeed` 0 after load, after a stroke and after a
    node move (0 of 40,000 pixels), and both edits changed it.
- **Performance** (4×4 green-2, `perf.mjs`; the agent's item 4 runs and
  mine on 8801 at load 7.8):

  | | H6 | H6b (agent) | H6b (mine) |
  | --- | --- | --- | --- |
  | Load, visible chunks final | 2.6 s | 584-615 ms | 620 ms |
  | Drag rAF p95 | 167-183 ms | 16.8 ms | 16.7 ms |
  | Move to chunk final, p50 / p95 | — | 49-84 / 56-122 ms | 49 / 53 ms |
  | After release, chunks final | 2.2 s | 592-599 ms | 614 ms |
  | Scroll p95 | 16.8 ms | 16.8 ms | 16.7 ms |
  | Export | 4.6 s | 1.55-1.59 s | 1.61 s |
  | JS heap peak | 408 MB | 162-167 MB | 197 MB |
  | Counted GPU, steady / peak | 52 MB / — | 205 / 374 MB | 205 / 374 MB |

  The agent saw one release of 1.14 s at host load 7; reruns gave 599 and
  592 ms.

**Still open:**
- **Drag latency is about 50 ms,** mostly waiting behind earlier bakes'
  relief and terrain passes (about 15 and 7 ms of GPU a chunk). Cheaper
  bakes during a drag, such as H7's quarter levels, would cut it; the
  prefix would not.
- **The outline is still sampled every move** (`drawMapBounds`, about
  325,000 samples in a 3.5 s drag, about 100 ms in all). It is cheap now;
  H7's skip-during-gesture idea stays open.
- **Mid-gesture CPU readers** (cursor height, picking) see the copy as it
  was when the gesture began.
- **23 tile pixels** differ from the CPU path's export, from the f32 Time
  pass input.
- **The Time pass's 164 MB** is counted from a formula, not read from the
  device.
- **Still on the CPU path:** fallback scenes, the study, and maps over
  1168 samples (H5b; the remaining JS kinds).
- **`gpuFeed=0`** now counts the GPU fields when it trims the chunk cache.
  Its images are unchanged.

### H7b. Quarter levels on the map canvas (Green)

> **Owner, 2026-10-29:** "Let's do h7 quarter levels, then the large map
> support to prove it out end to end, then the remaining shapes on the
> gpu." This is H7's item 3, which needed WGSL changes outside H7's files.

Read H7's, H6's and H6b's Done and Still open lists above, and
"Progressive rendering" in [docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md).

**What is there today** (4×4 Green, after H6b):
- **Every chunk is baked at final resolution:**
  - the feed pass (`engine-feed.wgsl`, about 0.6 ms of GPU);
  - the relief bake, into a fields texture of one texel per world pixel
    (`chunkFieldsOrigin` and `chunkFieldsSize` in `engine-common.wgsl`),
    about 10-16 ms of GPU a chunk;
  - the terrain draw, about 5-7 ms.
- **Load and release** are final in about 0.6 s. Drag rAF p95 is 16.7 ms.
- **A drag move reaches the screen** in 49 / 53 ms (p50 / p95). Most of
  it is waiting behind earlier bakes' relief and terrain passes; the shape
  run is 3-4 ms. Each move rebakes its dirty chunk at final.
- **The 2b hold.** While the Time pass is pending, the canvas paints
  cached chunks and bakes none, for at most 8 s.
- **`quality: 'preview'`** is a cheaper draw at full resolution, not a
  level.

**Scope.**
- **The GPU-fed map canvas:** Green's engine, `gpuShape` 1, `gpuFeed` 1,
  maps up to 1168 samples.
- **Everything else still bakes final only, unchanged:** other worlds,
  the CPU bake path, and the study.
- **A query switch, `levels`** (default 1; 0 is today's final-only
  canvas). No knob in `sculpt.py`.
- **Final pixels are unchanged.** The shaders take a new scale; at final
  it is 1, and every shader must give the same bytes as before.

**Deliver.**

1. **A quarter bake:** a chunk baked at half its width and height (a
   quarter of the pixels) and drawn at 2×.
   - **One scale.** The Green engine's shaders take world pixels per
     output texel: 1 at final, 2 at quarter. The relief bake and the
     fields texture run on that lattice, and the draw maps output texels
     to world pixels with it.
   - **State the resolution rule for each stage** at quarter:
     - the feed lattice, which stays on the world grid;
     - the relief bake;
     - the material level, using H4's footprint mips;
     - the shadows, and the 1-px marks.
   - **Side by side.** Show one chunk at quarter and at final, at 2×, on
     green-2's face and on a plain. It must be recognisably the same
     picture. Report the mean and p95 luma difference against final
     downsampled by 2.
   - This is its own commit, with the final-exactness checks below
     passing at `levels` 0 and 1.
2. **The schedule.**
   - **Drag.** A dirty chunk rebakes at quarter during the gesture. On
     release, the visible chunks bake final, then the margin.
   - **Load and scroll.** The visible chunks bake at quarter first, then
     final, in view order; then the margin; then the rest when idle.
     Measure whether quarter-first helps the load at all. If it delays
     final by more than 10%, keep final-only on load and say so.
   - **No step back.** The canvas never replaces a final image with a
     quarter image of the same revision.
   - **Export and `sampleHeights`** use final only.
   - **A debug overlay** marks each chunk's level (query
     `levelsOverlay=1`).
3. **Measure** with `perf.mjs map4`, and add what it lacks:
   - the move-to-picture latency at any level, which `perf.mjs` reports
     today;
   - the time from release until the visible chunks are final;
   - on load: when every visible chunk shows at least quarter, and when
     they are all final;
   - how the 2b hold interacts with quarter bakes.
4. **Memory.** Report what the quarter images cost against the budgets.

**Targets** (4×4 green-2, against H6b's 49 / 53 ms, 0.62 s and 0.61 s):
- move-to-picture latency p95 at most 30 ms;
- drag rAF p95 under 33 ms;
- after release, the visible chunks are final in at most 0.67 s;
- on load, the visible chunks are final in at most 0.68 s;
- scroll p95 unchanged.

**Exactness and acceptance:**
- **The study is untouched.** `compare.py $R/repro-out/merge-h6b <yours>
  --worlds none` is exact on all 27 scenes. If Green moves, run the
  ground rules' `false` test (rule 3). Compiler-only drift is recorded,
  not shipped silently; a real leak is gated.
- **The 4×4 export** at `levels` 1 is byte-identical to
  `$R/exports/H2Check8801x62959.ufo` (H6b's merge) apart from the name.
- **The 1× view after settling** (mapcheck's `view.png`) at `levels` 1 is
  identical to `levels=0`, apart from the status text.
- **The minimap** at `levels` 1 equals `levels=0` after load, after a
  stroke and after a node move: `$R/navcheck.mjs`, `$R/navedit.mjs` and
  `$R/navmove.mjs` (usage in each first line; the extra query is
  argv[6]).
- **`regional.mjs`** finds 0 mismatches on all 27 scenes.
- **Console:** no errors.

**Done when** NOTES.md has:
- the resolution rules and the side-by-side;
- each item measured on its own;
- the targets met, or by how much they were missed;
- memory;
- every exactness check above.

**Files:**
- `engine-common.wgsl`, `engine-bake.wgsl` and `engine-frag.wgsl`, only
  for the scale;
- in `sculpt-renderer.js`, only the bake and draw plumbing for the scale;
- `sculpt-chunk-renderer.js` and `sculpt-canvas.js`;
- `repro/perf.mjs`.
- Not `sculpt.py`, not the other worlds' shaders (`sculpt-common.wgsl`,
  `relief-bake.wgsl`, `sculpt-frag.wgsl`), not `sculpt.js`, and not the
  fields or the Time pass.

**Budget:**
- No stop points: hand back when done.
- Item 1 is its own commit, and so is item 2.
- If quarter cannot be built with final exact, stop and report what moved
  and why.

**Server and guard:**
- port 8870, CDP 9670;
- worktree `../terraform-wt-H7b`;
- assets `$R/agent-H7b`, with `mapcheck.mjs` copied from `$R/agent-H4`;
- baseline `$R/repro-out/merge-h6b`;
- guard `--worlds none`.

**Done (merged as 31e995e; EXPERIMENTS row 149; notes in
`$R/agent-H7b/NOTES.md`).** No final pixel changed.
- **The quarter bake (item 1).**
  - **One new uniform,** `chunkScale` (world pixels per output texel),
    in `engine-common.wgsl`. At 1 every term reduces to the old lookup.
  - **Relief bake:** fields texel j is the bake at
    `origin + 2j + 0.5`, the centre of its 2×2 block; `bakedFields`
    reads it with the same mapping.
  - **Draw:** the viewport is halved, clip space stays in world units,
    and the fragment scales its screen position back.
  - **What stays at final:** the shadow, occlusion and cavity taps stay
    in world units, and the mesh is the final mesh.
  - **Materials:** `uMaterialFoot` is multiplied by the scale, so H4's
    footprint mip 1 is used, and the plain's 16 tiles average 2×2.
  - **1-px marks** are sampled once per 2×2 block, not averaged, so they
    sparkle.
  - **The feed lattice and the Time pass** are unchanged.
  - **Quarter against final downsampled 2×2,** mean / p95 luma
    difference: face 9.9 / 35.6, plain 3.7 / 9.8, hills 5.5 / 16.7.
    By eye it is the same picture, blockier. The sheets are
    `$R/agent-H7b/out/lv2/{face,plain,hills}-side.png`.
  - **GPU cost per chunk,** quarter against final: relief bake 4.7
    against 15.6 ms, draw 3.2 against 7.6 ms.
- **The schedule (item 2).**
  - **During a drag,** dirty chunks rebake at quarter. On release, the
    visible chunks bake final, then the margin.
  - **Query switches:** `levels` (default 1), `quarterFirst` (off) and
    `levelsOverlay=1`, which marks each chunk Q or F.
  - **The painted-mask flags** are expanded on the GPU and copied into
    the uniforms in the same submission. This removes a mapped read from
    every fed bake, about 2 ms.
  - **Quarter-first on load** shows every visible chunk in about 470 ms
    against 630 ms, but puts final 15% later (759 / 722 / 727 against
    658 / 621 / 634 ms). That is past the card's 10%, so load and scroll
    stay final-first.
  - **During the 2b hold,** quarter images stay on screen where
    `levels=0` shows overview holes.
- **Performance** (4×4 green-2; the agent's alternating runs at load
  6.6-8.9, and mine on 8801 at load 9.6):

  | | H6b | H7b `levels=0` | H7b `levels=1` | mine | Target |
  | --- | --- | --- | --- | --- | --- |
  | Load, visible final | 620 ms | 621-643 | 569-585 | 660 | ≤ 680 |
  | After release, visible final | 614 ms | 594-636 | 531-551 | 586 | ≤ 670 |
  | Drag rAF p95 | 16.7 | 16.7-16.8 | 16.7 | 16.8 | < 33 |
  | Move to first picture, p50 / p95 | 49 / 53 | 46-47 / 50-81 | 45 / 50-53 | 47 / 57 | p95 ≤ 30 |
  | Scroll p95 | 16.7 | 16.7-16.8 | 16.7-16.8 | 16.8 | unchanged |
  | Export | 1.61 s | 1.58 s | 1.56-1.59 s | 1.60 s | no slower |

  With `levels=1` every move updates all three of its dirty chunks,
  where `levels=0` updates one: 2.7 times the chunk updates a second.
- **Memory.**
  - A cached image is 0.25 MiB at quarter, against 1.0 MiB at final.
  - The fields texture is 4.2 against 16.8 MB.
  - Counted GPU stays 205 MB steady, with a peak of 359-398 MB of 512.
- **Exactness** (the agent's checks, then mine on 8801):
  - the 27 study scenes are exact against `merge-h6b` and equal the
    agent's renders;
  - the 4×4 exports at `levels` 1 and 0 are byte-identical to
    `H2Check8801x62959` apart from the name;
  - the 1× view differs only in the status text;
  - the minimap equals `levels=0` after load, after a stroke and after a
    node move;
  - `regional.mjs` finds 0 on all 27 scenes;
  - there are no console errors.

**Still open:**
- **The latency target is missed: p95 50-53 ms against 30.** I accepted
  this, a decision made without the owner. The test harness delivers a
  move about 13-15 ms after its mark, and a quarter bake is about 16 ms
  (3 ms of JS, then the GPU), so 30 ms would need a bake of about 6 ms.
  Untried:
  - a cheaper draw while dragging;
  - a coarser mesh at quarter;
  - reusing chunk textures between bakes;
  - partial-chunk bakes, which the 204-px shadow apron limits.
- **A gesture's first move rebakes every visible chunk** at quarter, not
  only the dirty ones (`levels=0` does the same at final). This is not
  traced. A guess: `cancelWeather` bumps `weatherJob`, which is part of
  `api.revision()`.
- **The rest of the map at quarter when idle** is not built.
- **Quarter 1-px marks sparkle.**

### H5b. Large maps on the GPU, end to end (Green)

> **Owner, 2026-10-29:** "Let's do h7 quarter levels, then the large map
> support to prove it out end to end, then the remaining shapes on the
> gpu." This replaces the H5b outline above. It takes Green's whole GPU
> pipeline (shape, Time pass, chunk feed, levels) to maps over 1168
> samples, from load to export.

Read H5's, H6's, H6b's, H7's and H7b's Done and Still open lists above,
and the H5b and H2b outlines. Then read `sculpt-tiled-weather.js` (its
header explains the CPU tile geometry) and `sculpt-map-weather.js`.

**What is there today.**
- **Map sizes** (`configureMap` in `sculpt-map.js`; grid = size / 2):

  | Map | World size | Grid | Cells |
  | --- | --- | --- | --- |
  | 4×4 | 2336 | 1168 | 1.4M |
  | 8×8 | 4384 | 2192 | 4.8M |
  | 16×16 | 8480 | 4240 | 18M |
  | 40×40 | 20768 | 10384 | 108M |

- **Up to 1168 samples** (4×4), Green runs on the GPU from end to end.
  Whole-map buffers hold 31 B of shape fields a cell, and the Time pass
  needs 120 B a cell while it runs.
- **Over 1168, everything is still on the CPU:**
  - the JS regional fields replay windows;
  - weather comes from the old tiled CPU worker (`sculpt-tiled-weather.js`:
    256-interval cores, a 64-interval blend, a 128-interval apron), not
    Green's Time pass, so an 8×8 map does not show H5's look;
  - every chunk is read on the CPU and uploaded.

  H7 measured 8×8 at: load 16.2 s, release 7.5 s, drag p95 283 ms, export
  16.0 s.
- **Why whole-map buffers stop at 1168.** At 8×8 the masks alone are
  134 MB, over the 128 MB default storage-binding limit. The fields plus
  the Time pass would need about 830 MB, over the canvas's 512 MB budget.
  So large maps need the map in pages.

**Scope.**
- Green's engine on map canvases over 1168 samples: 8×8 is the proof,
  16×16 the stretch, and 40×40 must open and draw its view.
- **A query switch, `gpuPages`** (default 1 over 1168; 0 is today's CPU
  path). `gpuPages=force` pages a 4×4 map too, for comparison.
- **4×4 at the defaults is unchanged**, byte for byte.
- **Fallback scenes** (plateau, offset, lower, crater) keep the CPU path.
  The next card puts them on the GPU.

**Deliver.**

1. **Design (a stop point).** Hand back a short plan, with numbers,
   before building:
   - **The page geometry.** A page is a fixed core plus an apron. Its
     geometry depends on nothing but the world: not chunks, requests or
     budgets. State the core and apron in cells, and why the apron covers
     the reach of each shape pass (blur radii, hill sections, framed
     noise), of the Time pass, and of the chunk feed.
   - **How a chunk finds its page.** A chunk's lattice and apron must lie
     inside one page.
   - **Memory** per page (fields, Time pass, CPU copy), and how many
     pages fit in 512 MB with the chunk cache.
   - **The Time pass on pages.** Fine pages with aprons, with or without a
     coarse whole-map drainage pass first. Settle it by measuring on a 4×4
     map: paged (`gpuPages=force`) against whole-map, as max and p95 |Δh|,
     and changed 16-px blocks in the 1× view. Seams must not show at 2×.
   - **CPU readers** (overview, outline, picking, features, export
     heights): what they read on a large map.
   - **The device limits** you need, if any (`requiredLimits`), and what
     the adapter offers.
2. **Shape fields in pages.**
   - The shape passes evaluate a page's core and apron. Pages live in an
     LRU, counted by `fixedGPU()`.
   - An edit dirties the pages its reach touches. During a gesture only
     the dirty pages in view re-run, and nothing is read back (H6b's
     rules).
   - **Exactness:** on 4×4 at `gpuPages=force`, the paged planes equal
     the whole-map planes (report max |Δ| and mask steps; H6's quadrant
     check found 0).
3. **The Time pass on pages,** as item 1 settled. A page's weather is
   kept with the page, and redone only when its shape (or a neighbour
   within the apron) changed.
4. **Chunks fed from pages** (`engine-feed.wgsl`), with H7b's levels.
5. **Export on 8×8,** end to end from pages. Peak GPU and JS memory stay
   within the budgets; pages are evicted as the export walks the map.
6. **Measure** with `perf.mjs map8` (and a 16×16 run: add `map16`):
   load, drag, release, scroll, export, memory.

**Targets** (8×8 green-2, against H7's 16.2 s, 7.5 s, 283 ms and 16.0 s):
- load, visible chunks final: at most 2 s;
- after release, visible chunks final: at most 1 s;
- drag rAF p95: under 33 ms;
- export: at most 8 s;
- 16×16: report the same figures, with no target;
- 40×40: opens, draws its view, takes a stroke, with no console errors.

**Exactness and acceptance:**
- **The study is untouched:** `compare.py $R/repro-out/merge-h7b <yours>
  --worlds none` is exact on all 27 scenes, and `regional.mjs` finds 0 on
  all 27.
- **4×4 at the defaults:** the export is byte-identical to H7b's merge
  export apart from the name. The minimap (`$R/navcheck.mjs`,
  `navedit.mjs`, `navmove.mjs`) and the 1× view are unchanged.
- **4×4 at `gpuPages=force`,** against the whole-map path:
  - shape planes as item 2 says;
  - TNT heights, features and tile indices, reported (identical is the
    goal);
  - the view's changed blocks at the noise floor, and by eye the same;
  - no seam at 2× at page boundaries.
- **8×8 at `gpuPages` 1:**
  - the export passes its self-check;
  - the view shows Green's H5 look (compare a 4×4 crop of the same
    scene, by eye);
  - the minimap updates after an edit.
- **8×8 at `gpuPages=0`** is unchanged from H7b's merge (its export, byte
  for byte apart from the name).

**Done when** NOTES.md has:
- the design with its numbers;
- each item measured on its own;
- the targets met, or by how much they were missed;
- memory;
- every exactness check above.

**Files:**
- `sculpt-gpu-fields.js` and `engine-shape.wgsl`, for pages;
- `engine-feed.wgsl` and `sculpt-erosion.js`;
- `sculpt-canvas.js` and `sculpt-chunk-renderer.js`;
- in `sculpt.js`, only the seams (`makeRegionalFields`, the weather glue,
  `gpuFeedSource`, `readRegional`, `sampleRegional`);
- `sculpt-map-weather.js`;
- `repro/perf.mjs`.
- Not the draw or bake shaders (`engine-frag`, `engine-bake`,
  `engine-common`), not `sculpt.py`, and not the study path.

**Budget:**
- Item 1 is a stop point.
- After it, items 2-5 are each their own commit.
- If the budget runs short, stop after item 4 with NOTES.md saying what
  remains.

**Server and guard:**
- port 8871, CDP 9671;
- worktree `../terraform-wt-H5b`;
- assets `$R/agent-H5b`, with `mapcheck.mjs` copied from `$R/agent-H4`
  (it opens 4×4; make an 8×8 copy for the 8×8 checks);
- baseline `$R/repro-out/merge-h7b`;
- guard `--worlds none`.

**Done (merged as af9207e; EXPERIMENTS row 150; notes in
`$R/agent-H5b/NOTES.md`).**
- **Pages** (`createPagedFields` in `sculpt-gpu-fields.js`).
  - **Core** 512 cells, aligned to multiples of 512 and depending on the
    world alone: 8×8 is 5×5 pages, 16×16 is 9×9 and 40×40 is 21×21.
  - **Shape pages** keep a 4-cell ring, because the hill blur is the widest
    shape pass. Noise is evaluated directly at the capsule points instead
    of from whole-map tables. That is exact: on 4×4 at `gpuPages=force`,
    all 31 planes equal the whole-map planes.
  - **The page variant of `engine-shape.wgsl`** sits behind `#ifdef PAGES`.
    Both preprocessed texts equal the texts before the change, character
    for character, so the whole-map program is unchanged.
  - **Two LRUs, by bytes:** 9 shape pages (14.1 MB each) and 24 weather
    pages (5.2 MB each).
- **The Time pass on pages.**
  - It runs per page in a window of core + 128 and keeps only the core.
    The window's input is evaluated afresh from the node list.
  - There is no coarse drainage pass.
  - **On 4×4, paged against whole-map:**
    - max |Δh| .0005;
    - the export's TNT heights, features and tile indices are identical;
    - the 1× view changes 3 of 6,900 blocks;
    - no seam at 2×.
  - **On 8×8, apron 128 against 192:** max |Δh| .00056 over 4.8M cells,
    with identical TNT heights, so 128 stays.
  - `engine-erosion.wgsl` takes a window origin (`ox`, `oy`; 0 for a whole
    map), in its own commit outside the card's files.
- **Chunks: a gather, not one-page containment** (a departure from the
  card, ruled at the design stop).
  - A 512-px chunk's lattice reaches 202-342 cells past it, so holding it
    in one page would cost 8× the core's area.
  - Instead each bake gathers its lattice from at most 2×3 page cores into
    a reused staging set (43 MB, counted), and `feedMain` runs unchanged.
- **CPU readers.**
  - **The overview and outline** read a coarse lattice (every 8th cell),
    filled in the background, view pages first.
  - **Picking and the cursor** read CPU copies of resident pages.
  - **Export heights** use `readAsync`, by gather.
  - `maskChunks` is async.
- **Switch:** `gpuPages` (default on over 1168; 0 is the CPU path;
  `force` pages a 4×4).
- **Performance** (green-2; the agent's runs, and mine on 8801 at load 4.7-5.5):

  | 8×8 | before (H7 / agent's `before`) | H5b (agent) | H5b (mine) | Target |
  | --- | --- | --- | --- | --- |
  | Load, visible chunks final | 16.2 / 19.0 s | 0.78 s | 0.80 s | ≤ 2 s |
  | After release, chunks final | 7.5 / 8.8 s | 0.73 s | 0.70 s | ≤ 1 s |
  | Drag rAF p95 | 283 ms | 16.7 ms | 16.8 ms | < 33 ms |
  | Move to first picture, p50 / p95 | — | 49 / 61 ms | 52 / 103 ms | — |
  | Scroll p95 | — | 16.8 ms | 16.7 ms | — |
  | Export | 16.0 / 15.9 s | 6.3 s | 6.55 s | ≤ 8 s |

  - **16×16** (no export): load 0.80 s, release 0.79 s, drag p95 16.8 ms,
    GPU 386 MB.
  - **40×40:** the page opens in 0.5 s and the view is drawn in 1.0-1.25 s.
    The full overview (441 pages) takes 8.0 s. A hill stroke takes, with
    no console errors.
  - **4×4 at the defaults** is unchanged: mine load 0.60 s, release 0.52 s, drag p95 16.8 ms, latency 45 / 59 ms, export 1.52 s.
- **Memory (8×8).** GPU 371 MB at the end, with a peak of 461-475 MB of 512.
  The JS heap peaks at 167 MB.
- **My merge checks:**
  - the 27 study scenes are exact against `merge-h7b` and equal the
    agent's renders; `regional.mjs` 0 on all 27;
  - **the 4×4 default export:** its TNT section and everything after it
    are byte-identical to H7b's, and the indexed PNG is identical. Only
    the archive header differs, because the export name is one character
    shorter;
  - the 4×4 view differs only in the status text, and the three minimap
    checks are 0 pixels from H7b's;
  - **8×8 at `gpuPages=0`:** the export is byte-identical to the agent's
    `before` export (`H2Check8871x77791`) apart from the name;
  - **8×8 paged:**
    - the export passes its self-check (tnt, ota, archive), with 1,072
      unique tiles of 17,028 slots;
    - against the CPU path, TNT heights differ on 590 of 68,112 cells
      (max 4), as expected: Green's Time pass replaces the old tiled
      worker;
    - by eye the view matches the 4×4 GPU look, where the CPU path shows
      the old gullies;
    - an edit changes 405 minimap pixels.

**Still open:**
- **Plateau and the other fallback kinds** still send a scene to the JS
  fields on every size; on 40×40 a plateau stroke took 13 s. That is H6c.
- **The Time pass is demand-driven.** A view that needs 6-9 uncomputed
  pages pays about 30 ms each before its first picture (included in the
  0.78 s).
- **The overview and outline interpolate the coarse lattice,** so the
  minimap is up to 3 levels from the exact one.
- **Apron 128** is measured on green-2 only.
- **16×16 export** is not run: its 66,820 tile slots exceed the TNT's
  65,536.
- **While dragging on 8×8,** every rebaking chunk shows a move at p50 186
  and p95 383 ms. The first chunk is at 49 / 61 ms.
- **GPU peak** is 461 MB of 512; 7 shape pages would give back about
  28 MB.

### H6c. The remaining shapes on the GPU (Green)

> **Owner, 2026-10-29:** "Let's do h7 quarter levels, then the large map
> support to prove it out end to end, then the remaining shapes on the
> gpu." After this card, a Green scene drawn with any tool in the palette
> stays on the GPU path.

Read H6's, H6b's and H5b's Done and Still open lists above, and the H6
outline in [docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md#cards).

**What is there today.**
- **On the GPU** (`engine-shape.wgsl`, `nodeSupport` and `prepareNode` in
  `sculpt-gpu-fields.js`): paint, erase, deep, shallow, hill, mountain and
  the ground node, with Green's default options.
- **Anything else sends the whole scene back to the JS engine**, and with
  it the map canvas back to the CPU path (no feed, no levels, no pages):
  - the kinds plateau, ramp, smooth, offset (Raise / lower), lower,
    crater, fissure, crystal, sand and grass. **Plateau is the palette's
    default tool,** so a new user's first stroke falls back;
  - options that `nodeSupport` refuses: ridge options (spurs, crest
    jag/vary/taper), hill lobes, facets and base options, the coast pass,
    water fingers, bank and plates, shape mask writes, water mask choices,
    a parametric cross-section, a hill outside the shouldered form, and
    paint or erase without natural edges.
- **The flow kinds** (river, source) are skipped by the shape passes; the
  flow bake owns them.
- **Point reads.** Plateau, crater and ramp read the height of the prefix
  (every node before them) at their points to set their level. On H5b's
  pages, such a point can lie in another page. Even on the whole map, a
  point outside the rectangle being re-evaluated holds the finished
  fields, not the prefix. H5b's note (`$R/agent-H5b/NOTES.md`, "H6c
  forward note") answers it by evaluation: run `nodes.slice(0, i)` in a
  small window around the point, through `engine.submit(list, ctx, rect,
  {target, prepare})`, and read the cell.
- **The page ring** (H5b) is 4 cells: the hill blur is the widest shape
  pass today. Kinds that reach further (smooth's radius, a crater's rim
  and ejecta, a fissure's branches) need the ring to cover them.
- **The study's Green scenes** use only GPU kinds (green-1: deep, hill,
  paint; green-2: hill, erase, paint; green-3: hill, mountain, deep), so
  porting more kinds moves no study render.

**Scope.**
- The palette's kinds, at their default options, on every surface the
  GPU path serves: the study, the 4×4 whole-map canvas and H5b's pages.
- The options `nodeSupport` refuses, where a pass is cheap; report the
  rest.
- The JS engine stays as the reference and the fallback (decision 10).

**Deliver.**

1. **Inventory (a stop point).** Hand back, for each kind and refused
   option:
   - its JS size (lines), and the passes it needs;
   - what it reads: points of the prefix, a neighbourhood of the prefix
     (smooth), or nothing;
   - its reach in cells, for H5b's page apron (today 4 cells);
   - its expected cost;
   - a recommended order, and what should stay on JS.
2. **Port the kinds,** in the order item 1 settles, starting with
   plateau. Each kind is its own commit, with:
   - a scene for it in `repro/shape-scenes/`;
   - `shapecheck.mjs` against JS, on the study and on a 4×4 map
     (`--map`): max |Δh| at most .001, masks at most one step on a few
     cells (H6 got .0002-.0005).
3. **Point reads** on the GPU: the prefix height at a node's points,
   evaluated in a small window as H5b's note describes, on the whole map
   and on pages alike. The passes read the result in the same submission;
   there is no CPU round trip per node.
4. **The page ring.** Grow H5b's ring to cover the reach of each kind you
   port, or give a far-reaching kind (smooth) a wider window of its own.
   The geometry still depends on the world and the node list alone. Report
   the ring and its memory cost.
5. **The refused options,** where cheap, after the kinds.
6. **Measure** a plateau scene on the 4×4 and 8×8 canvases with
   `perf.mjs` (`--scene` with a plateau stroke), against the same scene
   today (the JS fallback): load, drag, release and export.

**Exactness and acceptance:**
- **The study:** `compare.py $R/repro-out/merge-h5b <yours> --worlds
  none` is exact on all 27 scenes. Their kinds are already on the GPU.
  `regional.mjs` finds 0 on all 27.
- **Per kind:** `shapecheck.mjs` as in item 2, on the study and on 4×4.
- **4×4 green-2 at the defaults:** the export is byte-identical to H5b's
  merge export apart from the name, and the minimap checks pass.
- **A plateau scene on 4×4:** TNT heights, features and tile indices
  against `gpuShape=0` (JS), reported (identical is the goal); the view
  at the noise floor, and by eye the same.
- **A plateau scene on 8×8** (pages): the export passes its self-check,
  and the view shows no seams at 2×.

**Done when** NOTES.md has the inventory, each kind's check, the
measurements and every exactness check above, plus what stays on JS and
why.

**Files:**
- `engine-shape.wgsl` and `sculpt-gpu-fields.js`;
- in `sculpt.js`, only `shapeContext` and the probe-stroke parameters;
- `repro/shapecheck.mjs` and `repro/shape-scenes/`.
- Not the draw, bake, feed or Time pass shaders, not `sculpt.py`, and not
  the JS engine itself.

**Budget:**
- Item 1 is a stop point.
- After it, each kind is its own commit.
- If the budget runs short, stop after plateau, offset and lower (the
  kinds a new user reaches first), with NOTES.md saying what remains.

**Server and guard:**
- port 8872, CDP 9672;
- worktree `../terraform-wt-H6c`;
- assets `$R/agent-H6c`, with `mapcheck.mjs` copied from `$R/agent-H4`;
- baseline `$R/repro-out/merge-h5b`;
- guard `--worlds none`.

**Done (merged as b6dc0a1; EXPERIMENTS row 151; notes in
`$R/agent-H6c/NOTES.md`).**
- **Ten kinds on the GPU,** one commit each: plateau, offset, lower,
  sand and ground cover, smooth, ramp, crater (with its craterlets),
  fissure, and crystal (pyramid form). At Green's default options none
  of them falls back. The new kinds are in new entry points (`stampN`
  and others), and the existing kinds' shader code is textually
  unchanged.
- **Shapecheck, GPU against JS** (max |Δh|, study / 4×4):

  | Kind | Study | 4×4 |
  | --- | --- | --- |
  | Plateau | 0 | .00029 (1 mask cell one step off) |
  | Offset, lower, cover, smooth, crystal | 0 | .00027 |
  | Ramp | 0 | .00029 |
  | Crater | 0 | .00041 |
  | Fissure | 0 | .00209, over the card's .001 (5 mask cells one step off; 0 cells over .01) |

- **Point reads.**
  - A node that reads the prefix at a point gets it from a small window
    of the earlier nodes, evaluated with the PAGES shader. A `pointRead`
    pass writes the bilinear value into a new binding. All of it runs in
    one submission, with no CPU round trip.
  - Plateau reads one point, ramp two, and a crater one per crater: each
    craterlet reads after the main crater and the earlier craterlets.
- **The page ring** depends on the node list: 4 plus the deepest chain
  of overlapping smooth radii, bucketed to 4, 16, 32 or 64 (14.1-21.3 MB
  a page).
  - A deeper chain falls back to JS with a stated reason.
  - A bucket change drops the pages' shape buffers but keeps their
    weather.
  - At ring 4 the smooth scene was 1.09 off on paged 4×4; the bucketed
    ring makes it 0.
- **Paged against whole-map** (4×4 `gpuPages=force`): 0 for every kind,
  except ramp at 1 ulp in 3 planes.
- **A plateau scene** (green-2 plus 5 plateaus), GPU against the JS
  fallback, which is the path main took for any plateau:

  | | 4×4 GPU | 4×4 JS | 8×8 GPU | 8×8 JS |
  | --- | --- | --- | --- | --- |
  | Load, final | 0.63 s | 8.46 s | 0.74 s | 17.6 s |
  | Drag rAF p95 | 16.7 ms | 333 ms | 16.8 ms | 267 ms |
  | Move to picture, p50 | 45 ms | 1,122 ms | 49 ms | 832 ms |
  | After release, final | 0.53 s | 2.11 s | 0.72 s | 7.82 s |
  | Export | 1.64 s | 4.87 s | 7.04 s | 15.5 s |

  My runs on 8801 (GPU): 4×4 load 0.61 s, release 0.55 s, drag p95 16.8 ms, move to picture 45 / 50 ms, export 1.93 s; 8×8 load 0.92 s, release 0.80 s, drag p95 16.7 ms, 47 / 54 ms, export 7.15 s (load 5.0-5.3).
- **Exactness** (the agent's checks, then mine on the merge):
  - the 27 study scenes are exact against `merge-h5b` on the final build;
    `regional.mjs` gives 0 on all 27;
  - the 4×4 green-2 default export's TNT section is byte-identical to
    H5b's, its indexed PNG identical, and its self-check passes;
  - the three minimap checks are 0 pixels from H5b's;
  - **the plateau scene on 4×4, GPU against `gpuShape=0`:** TNT heights,
    features and tile indices identical; 440 indexed pixels of 4.5M
    differ; the 1× view is at the noise floor of the existing kinds;
  - **on 8×8:** the export self-check passes, and by eye there is no seam
    at 2× across a page boundary;
  - my shapecheck on the merge: plateau .0003 (1 mask cell), fissure .0021 (5 mask cells), both repeat-identical.

**Still open:**
- **Fissure at 4×4** is .00209 from JS, over the card's .001. The study is
  exact. A guess: f32 world positions at map scale on the steep cut edge.
- **Not ported, though cheap:**
  - base options (baseVary, baseBump, moonLobes);
  - shape-mask writes and water mask choices for plateau, offset and
    crater;
  - plateau, offset, sand and grass without natural edges;
  - hill lobes, the parametric cross-section and ridge options.

  Each falls back with a stated reason.
- **On JS by design:**
  - the coast pass, water fingers, bank and shore plates;
  - mountain and crater facets, crater rim spurs, rim sectors and gaps;
  - crystal columns and bergs;
  - a smooth chain deeper than ring 64.
- **Routes rule.** The new kinds use JS's rule (`kind != smooth && value
  != base`). Hill and erase still use `influence > 0`; the two differ only
  where a value lands exactly on its base.
- **The F-direct shortcut** for point reads inside the evaluated
  rectangle was not built.

### H8. One engine for every world

> **Owner, 2026-10-30:** "Green slice is accepted. Let's continue porting
> the other worlds to the GPU before we retire things." "I prefer a single
> workflow, branching based on features not worlds/biomes, and to keep
> branches simple if possible. Whatever can be shared should be." "The end
> goal is still simplification."

Read [docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md) first: decisions
12-15, "Migration", and in "Rules for the cards" the two H8 rules (share,
don't copy; the engine's counts). Then read H4's, H5's, H6b's and H5b's
Done and Still open lists above. H9 runs beside this card.

**What is there today.**
- **The engine is Green's.**
  - `WORLD_KNOBS['green']` sets `engine` 1 and `materialModel` 1.
    `ENGINE_KNOBS['green']` holds 21 more knobs that apply only under
    engine 1, `gpuShape` 1 among them (`sculpt.py`).
  - Under engine 1 the renderer always loads `materials/green.json` and
    `engine-materials.wgsl`, and binds the generated textures in place of
    the rock images, whatever the world (`sculpt-renderer.js`: the shader
    list in the constructor, and the texture loop).
  - The engine shaders began as copies of the shared ones, so they still
    carry every world's helpers: 20 functions, about 330 lines (moon cups,
    ice hatch, crystal water and others). Knobs reach them, not a world id.
- **Weather.** `queueWeather` (`sculpt.js`) starts the CPU worker unless
  the engine is on, `erosion` is above 0 and the canvas is at most 1168
  samples. So a world with `erosion` 0 runs the worker even under
  engine 1.
  - The worker also makes the apron (at the `scree` slider), sand
    (`sculpt-sand.js`), flow, deposit and material weathering, set per
    world through `config.defaults` and `config.material`.
  - Paged canvases (`pagedOn`) run only the GPU pass.
- **Shape.** With `?engine=1&gpuShape=1`, each stroke of the 27 scenes run
  alone (coordinator's census, 2026-10-30):
  - Green, Archipelago and Zhon: every stroke on the GPU.
  - Red, Moon, Lava, Crystal and Ice use options the GPU refuses, and
    Desert never tries the GPU path. H9 owns all of this.
  - A scene that falls back runs the JS engine and, on a map canvas, the
    old CPU path (no feed, levels or pages). Leave that as it is.
- **A world's settings live in four places:** `KNOB_DEFAULTS` with
  `WORLD_KNOBS`, `ENGINE_KNOBS`, and `config.defaults` (variants) and
  `config.material` (both set in `biome_config`). Its prepared images are
  a fifth. The target is one preset per world; move only what this card
  needs.

**Scope.**
- Every world draws with the engine and runs its pipeline: the Time pass
  on the GPU, the chunk feed, levels and pages, and the GPU shape wherever
  `nodeSupport` takes the scene.
- **Engine 0 stays exactly as it is.** It is the comparison, and the
  retire card's target.
- **No deletion** (decision 13) **and no look work.** A world should draw
  on the engine as close to its current render as the engine allows.
  Where it moves, NOTES.md says why and which feature card owns the gap
  (TERRAIN_ENGINE "Migration").
- **Not H9's work:** `engine-shape.wgsl`, `sculpt-gpu-fields.js`, and in
  `sculpt.js` `shapeContext` and the probe-stroke parameters.

**Deliver.**

1. **Inventory (a stop point).** Hand back:
   - every place the engine path assumes Green, by file and function, and
     how each becomes data;
   - per world, what its draw reads that the CPU worker makes today
     (apron, sand, flow, deposit, material weathering, the `broad`
     profile), and whether the Time pass already makes it, at what
     settings;
   - renders of all 27 scenes with `engine=1` as the code stands:
     `compare.py` against `merge-h6c`, the triptychs, and any console
     errors. Let `repro/all.sh` take extra page parameters (a
     `REPRO_QUERY` variable passed to `render.mjs --query`);
   - a proposal: each world's preset (which agents run, at what rates),
     and the shared rules the Time pass still lacks.
2. **The engine by preset.** Engine 1 becomes every world's default, with
   `gpuShape` on. A world's engine settings sit in its preset. With
   `?engine=0` every world still draws as `merge-h6c` does.
3. **Materials by data.**
   - The renderer loads `materials/<world>.json` when the world has one.
   - Otherwise it binds the world's prepared images as engine 0 does.
     This is the bridge the Materials card removes.
   - Nothing chooses by world id; the renderer chooses by what the
     world's data holds.
4. **The Time pass for every world.** No world runs a CPU worker on the
   engine path.
   - The agents run by preset numbers. A world with no rain erosion today
     runs the pass with rain off, and the pass still makes every data map
     its draw reads.
   - A data map the worker makes and the pass lacks (Archipelago's sand,
     material weathering, the apron at a world's `scree`) becomes a shared
     rule in the pass, or goes in NOTES.md with its reason.
5. **Map canvases.**
   - A 4×4 export for every world: clean console, unique tiles reported,
     no seams at 2×.
   - An 8×8 export of one world other than Green, through pages.
   - `perf.mjs` on that world at 4×4 and 8×8 (load, drag, release,
     export), against `engine=0`.
6. **Counts.** The engine's counts table from the rules, before and after.

**Exactness and acceptance.**
- **Green** is exact against `merge-h6c` on its three scenes.
- **Engine 0:** with `REPRO_QUERY=engine=0`, every world is exact against
  `merge-h6c`.
- **The other worlds on the engine:**
  - `stats.py` on each world's three windows. No metric may leave the
    world's retail range (p10-p90) where `merge-h6c` was inside it.
  - The triptychs show no new artefact at 1×.
  - A move toward retail is fine (decision 2).
  - Zhon has no retail windows; judge it by eye against `merge-h6c`.
- **`regional.mjs`** finds 0 on all 27.
- **The gate** in the rules names no world.

**Done when** NOTES.md has the inventory, each world's preset and why,
the stats tables and sheets, the map checks, the measurements, and the
counts table.

**Files:**
- `sculpt-renderer.js`;
- `sculpt.py`: the presets (`WORLD_KNOBS`, `ENGINE_KNOBS`), and
  `biome_config` only as far as the presets need;
- in `sculpt.js`, the engine and weather choices: `queueWeather` and the
  paged weather, `gpuShapeOn`, `pagedWanted` and the feed's eligibility;
- `engine-frag.wgsl`, `engine-bake.wgsl`, `engine-common.wgsl`,
  `engine-materials.wgsl`, `engine-erosion.wgsl`, `engine-weather.wgsl`
  and `sculpt-erosion.js`;
- `materials/`, and `repro/all.sh` for `REPRO_QUERY`.
- Not `engine-shape.wgsl` or `sculpt-gpu-fields.js` (H9's: if the paged
  Time pass needs a change there, report it at the stop), the shared
  shaders, the CPU workers, or the JS shape engine.

**Budget:**
- Item 1 is a stop point.
- After it, items 2, 3 and 4 are a commit each, at least.
- If the budget runs short, stop after items 2-4 on the study, with
  NOTES.md saying what remains.

**Server and guard:**
- port 8873, CDP 9673;
- worktree `../terraform-wt-H8`, branch `H8-one-engine`;
- assets `$R/agent-H8`, with `mapcheck.mjs` copied from `$R/agent-H4`;
- baseline `$R/repro-out/merge-h6c`;
- guard `--worlds red,desert,archipelago,moon,zhon,lava,crystal,ice`
  (Green stays exact).

**Done (merged as 92c1b63; EXPERIMENTS row 152; notes in
`$R/agent-H8/NOTES.md`).**
- **Every world draws on the engine.** `engine` 1 is the default. With
  `?engine=0` the 24 non-Green scenes are exact against `merge-h6c`, and
  Green is exact against `merge-h3`, its engine-0 picture.
- **Presets.** `ENGINE_KNOBS` holds each world's engine preset. The other
  eight run the Time pass with rain off and the worker's envelope:
  `erosion` 1, `erosionRain` 0, `erosionEnvelope` .12 (`LIGHT_PASS` in
  `sculpt.py`). Rain off was nearer the worker's picture than rain 1 on
  the three scenes tried.
- **Materials by data.** A world names its table in its config
  (`materialTable`); only Green has one. The others bridge:
  - their prepared images fill the generated array, with 256 px images
    tiled 2×2 and mips made from the images;
  - their placement rows are built from their knobs. `greenPlace` is now
    `landPlace`, the one placement function.
- **The bridge,** `engine-bridge.wgsl` (192 lines), is gated by the
  uniforms the code already had. Each block names the card that replaces
  it:
  - quilted ground, beach and sand bars: Shores;
  - slate faces: Bodies;
  - mineral margins, fringe, ring veins and the sediment transition:
    Geology or Materials.
- **A new shared Time-pass rule:** the material field (`engine-weather.wgsl`
  `mf*`, 166 lines, and `materialField` in `sculpt-erosion.js`). It writes
  grid layer 1 when Material weathering is above 0 (Archipelago), in place
  of the worker's `weatherMaterials`. By eye, Archipelago's ring contours
  are the worker's.
- **No CPU worker** runs on the study or on maps up to 1168 samples, for
  any world. The CPU sand model has no user (TERRAIN_ENGINE "Combine or
  drop").
- **Fixed on the way:** engine-0 map canvases, broken since H7b (the chunk
  scale was set on shaders without it), and `perf.mjs`, which opened Green
  for every scene. `repro/all.sh` takes `REPRO_QUERY`, and
  `repro/gate.sh` runs the world-name gate.
- **Study against `merge-h6c`, at the defaults:**
  - Green is exact.
  - Mean |diff| per scene: Archipelago .70 / 2.71 / 2.93, Crystal .88 /
    .68 / .52, Desert 6.69 / 2.33 / 4.77, Ice 4.63 / 1.53 / 1.80, Lava .84
    / 2.01 / 2.58, Moon 4.94 / 2.52 / 3.66, Red .96 / .75 / .42, Zhon 1.27
    / .72 / .53.
  - By eye: the same looks. Desert's and Moon's faces are a little
    softer.
  - `stats.py`: no `height.*` metric left its retail range. Newly outside:
    red-2's thin dark density (by rounding) and zhon-1's edge orientation.
- **4×4 exports** (each world's preset against the engine with `erosion`
  0): self-checks pass, no nearest pixels, clean console, no seams at 2×
  (eight worlds, by eye). Zhon cannot export, by design.

  | World | Corners changed by more than .5 | Largest change |
  | --- | --- | --- |
  | Archipelago | 0% | 0 |
  | Red | 0.3% | 2.2 |
  | Moon | 0.9% | 5.2 |
  | Crystal | 0.8% | 5.6 |
  | Lava | 1.6% | 4.2 |
  | Desert | 1.2% | 4.5 |
  | Ice | 2.3% | 4.9 |
- **8×8 Archipelago through pages** (`gpuShape=1`) passes its self-check.
- **Coordinator's merge checks:** the 27 renders equal the agent's; all
  27 have replay mismatch 0 and a clean console; `regional.mjs` finds 0 on
  all 27; with `engine=0` all 27 are exact against the agent's `engine=0`
  renders; the 4×4 green-2 export's TNT heights, features, tiles and
  indexed picture are identical to H6c's; the gate passes.
- **The engine's counts** (3faedcd → H8):

  | The engine path | Before | After |
  | --- | --- | --- |
  | Engine shader lines: frag, bake, common | 1,963, 1,439, 769 | 1,975, 1,439, 770 |
  | Bridge lines, and bridged images | none | 192, and 28 |
  | GPU pass lines: weather | 85 | 251 (the material field) |
  | Uniforms | 375 | 376 |
  | World-named identifiers | 78 | 77 |
  | Worlds on the engine | 1 of 9 | 9 of 9 |
  | Worlds that run a CPU worker on the engine path | none | none up to 1168 samples; the eight others over it (H8b) |

**Still open:**
- **GPU shape is off for the other eight worlds** (H8b). With `gpuShape=1`
  the study picture moves: zhon-1 by mean |diff| 28.6 with replay
  mismatch 63, archipelago-3 by 13.1 (2.9 with it off), red-1 by 5.0 (1.0
  off). The shape planes pass `shapecheck`, so the cause is elsewhere.
  - For zhon-1 the likely cause is that the GPU path skips `flowbake`
    nodes, whose stored planes the JS replay copies back (`applyResult`).
    This is the coordinator's reading, not yet checked.
  - Until it is on, those worlds' maps over 1168 samples are not paged
    and run the tiled CPU worker, and the fed path carries no material
    field.
- **Dragging on the other worlds' maps** takes 250-333 ms a frame at
  p95, against Green's 16.7: the GPU feed needs `gpuShape`.
- **Archipelago's chunk bake** costs about seven times Green's (8×8 load
  15.1 s).

### H8b. GPU shape for every world

> **Owner, 2026-10-30:** "Let's continue porting the other worlds to the
> GPU before we retire things." "I prefer a single workflow, branching
> based on features not worlds/biomes ... Whatever can be shared should
> be." "The end goal is still simplification."

Read H8's and H9's Done and Still open lists above, and in
[docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md) decisions 12-16 and
"Rules for the cards".

**What is there today.**
- **Every world draws on the engine** (H8), but the GPU shape
  (`gpuShape`) is on only for Green (`ENGINE_KNOBS`). The other eight
  worlds' presets are `LIGHT_PASS` without it.
- **Turning it on moves pictures.** H8 measured this before H9, with
  `gpuShape=1` against the defaults: zhon-1 by mean |diff| 28.6 with
  replay mismatch 63, archipelago-3 by 13.1, red-1 by 5.0. The shape
  planes pass `shapecheck`, so the cause lies outside them.
  - zhon-1 is the only scene with a flow bake (a `flowbake` stroke). The
    GPU path's `KIND` has no `flowbake`, while the JS replay copies the
    bake's stored planes back (`applyResult`, called from `applyNode`).
    This is the coordinator's reading, not yet checked.
- **H9's gaps on map canvases (4×4):**
  - a deep stroke with a cross-section is 4.0 off on about 120 cells.
    `nodeSupport` refuses it for now ('deep cross-section');
  - ridge options are up to 1.15 off on 0.6-1.2% of cells;
  - crater rims are .41 off;
  - Desert's section is .84 off on 0.003% of cells.

  The study shows the same gaps (H8b's corrected check). H9's ".16
  between the JS engine's own entry paths" did not reproduce.
- **The census after H9** (`$R/agent-H9/refusals.mjs`; output in
  `$R/repro-out/merge-h9-census.log`):
  - every stroke of Green, Archipelago, Zhon, Desert and Moon runs on the
    GPU, and all of Red's except red-3's deep cross-section;
  - Lava, Crystal and Ice keep options that the Shores and Bodies cards
    rebuild.
- **Without the GPU shape,** a world's maps over 1168 samples are not
  paged and run the tiled CPU worker. The GPU feed is off, so a drag on
  those maps takes 250-333 ms a frame at p95, against Green's 16.7. The fed
  path also carries no material field.

**Scope.**
- Make `gpuShape=1` correct for every world, and turn it on in every
  preset.
- Not the options the Shores and Bodies cards own. A scene that uses one
  falls back to JS as it does today.

**Deliver.**

1. **Diagnosis (a stop point).** Hand back:
   - all 27 scenes with `gpuShape=1` against `merge-h9`: mean |diff| and
     replay mismatch for each;
   - for each scene that moves, its cause (file and function) and the
     fix you propose;
   - the cause of each map-canvas gap above;
   - where JS itself disagrees, what the 4×4 tolerance should be, with
     the evidence.
2. **Fix the causes,** one commit each.
3. **The deep cross-section on maps.** Remove its refusal once it passes.
4. **`gpuShape` 1 in every preset** (`LIGHT_PASS`).
5. **The material field on fed and paged canvases,** when Material
   weathering is above 0 (Archipelago).
6. **Maps.**
   - 4×4 for every world: the export's self-check, and TNT heights
     against `gpuShape=0` (the share that changes, and the largest
     change).
   - 8×8 through pages for Red and Moon: pages used, self-check, no seams
     at 2×.
   - `perf.mjs` on Red at 4×4 and 8×8 (load, drag, release, export),
     against `merge-h9`. The target is a drag p95 near Green's.
7. **Counts:** the engine's counts table, before and after.

**Exactness and acceptance.**
- **The study at the defaults:**
  - every scene within mean |diff| 0.1 of `merge-h9`, or explained in
    NOTES.md with its cause and why the new picture is right;
  - replay mismatch 0;
  - `regional.mjs` 0 on all 27.
- **Green** exact against `merge-h9`, on the study and in the 4×4
  green-2 export.
- **Engine 0:** with `REPRO_QUERY=engine=0`, all 27 exact against
  `merge-h8-e0`.
- **`shapecheck`** on each world's scenes: max |Δh| at most .001 on the
  study. On 4×4 the same, wherever the JS paths agree with each other.
- **The gate** (`repro/gate.sh`) passes.

**Done when** NOTES.md has the diagnosis, each fix with its check, the
map checks, the measurements and the counts table.

**Files:**
- `sculpt-gpu-fields.js` and `engine-shape.wgsl`;
- in `sculpt.js`: the shape, flow-bake, feed and paged-weather code;
- `sculpt.py`: `LIGHT_PASS` only;
- `sculpt-erosion.js` and `engine-weather.wgsl`, for the material field
  on the fed path;
- `sculpt-flow-ui.js`, only if the flow bake's planes need a hook;
- `repro/` tools.
- Not the draw, bake or bridge shaders, the shared shaders, the CPU
  workers, or the JS shape engine.

**Budget:**
- Item 1 is a stop point.
- If the budget runs short, stop once Zhon, Archipelago and Red are
  correct with `gpuShape` on, with their presets on, and NOTES.md saying
  what remains.

**Server and guard:**
- port 8875, CDP 9675;
- worktree `../terraform-wt-H8b`, branch `H8b-gpu-shape`;
- assets `$R/agent-H8b`, with `mapcheck.mjs` copied from `$R/agent-H4`;
- baseline `$R/repro-out/merge-h9` (`merge-h8-e0` for engine 0);
- guard `--worlds red,desert,archipelago,moon,zhon,lava,crystal,ice`,
  with the 0.1 target above.

### H9. Every shape option on the GPU

> **Owner, 2026-10-30:** as H8. After this card, the only shapes that
> fall back to JS are the ones the Shores and Bodies features rebuild.

Read H6c's card, its Done and Still open lists above, and
`$R/agent-H6c/NOTES.md` (its inventory, "Item 1"). Read the TERRAIN_ENGINE
decisions 12-15 and the two H8 rules. H8 runs beside this card.

**What is there today.**
- **The census** (`?engine=1&gpuShape=1`, each stroke of a scene run
  alone, coordinator's run on 2026-10-30; the script is
  `$R/agent-H9/refusals.mjs`, usage in its first lines; its output is
  `$R/agent-H9/census-merge-h6c.json`):

  | World | Reasons |
  | --- | --- |
  | Green, Archipelago, Zhon | none |
  | Red | parametric cross-section (red-2, red-3); water mask choices (red-3) |
  | Moon | hill lobes, facets or base options (most hills); ridge options (moon-3); crater rim spurs (moon-2) |
  | Lava | the coast pass (every stroke of all three); ridge options (lava-3) |
  | Crystal | crystal columns or bergs; water fingers, bank or plates; crater facets |
  | Ice | water fingers, bank or plates; crystal columns or bergs |
  | Desert | none given, but the GPU path is never tried: `sculptDebug.shape()` stays `{reason: null, used: false}` for every stroke. Cause unknown |
- **H6c's inventory** sorted the refused options:
  - cheap and positional: the base options (`baseVary`, `baseBump`,
    `moonLobes`); shape-mask writes and water mask choices for plateau,
    offset and crater; plateau, offset, sand and grass without natural
    edges;
  - medium: hill lobes (about 32 JS lines), the parametric cross-section
    (about 190), ridge options (spurs and crest jag, vary and taper, about
    150);
  - left on JS: the coast pass (a connectivity flood and distance
    transforms over the prefix, about 300 lines), water fingers, bank and
    shore plates; mountain and crater facets (they read ±3 cells of their
    own result); crater rim spurs, rim sectors and gaps; crystal columns
    and bergs.

**Scope.**
- Desert's cause first. Then every option H6c called cheap or medium,
  then crater rim spurs, sectors and gaps.
- **Not** the coast pass, fingers, bank, shore plates, facets, or crystal
  columns and bergs. The Shores and Bodies cards rebuild those as shared
  models (a coast distance field on the GPU). Say what each would need.
- The JS engine stays as the reference.

**Deliver.**

1. **Inventory (a stop point).** Bring H6c's up to date and add:
   - Desert's cause;
   - per option, the worlds and scenes that use it;
   - options that duplicate another (the same effect by another route) and
     could be dropped to simplify. The owner decides those, so list them
     with the evidence;
   - the order.
2. **Port the options** in that order, each its own commit, each with:
   - a scene in `repro/shape-scenes/`;
   - `shapecheck.mjs` against JS, on the study and on a 4×4 map: max |Δh|
     at most .001, masks at most one step on a few cells.
     `shapecheck.mjs` runs Green's engine today; let it take any world
     (the scene's world, with `engine=1&gpuShape=1`).
3. **The census again,** with the reasons left for each world.
4. **The page ring** for any option that reaches past it.

**Exactness and acceptance.**
- **The study at the defaults** is exact against `merge-h6c` on all 27
  (`--worlds none`). Only Green has `gpuShape` on by default, and its
  scenes use no refused option.
- **Per option:** `shapecheck.mjs` as in item 2.
- **`regional.mjs`** finds 0 on all 27, and again on every Red and Moon
  scene with `engine=1&gpuShape=1`.
- **A 4×4 map** of one Red and one Moon scene with `engine=1&gpuShape=1`:
  TNT heights, features and tile indices against `gpuShape=0`, reported
  (identical is the goal).

**Done when** NOTES.md has the inventory, each option's check, the census
before and after, and what stays on JS and why.

**Files:**
- `engine-shape.wgsl` and `sculpt-gpu-fields.js`;
- in `sculpt.js`, only `shapeContext`, the probe-stroke parameters, and
  the code that decides whether the study runs the GPU shape (Desert);
- `repro/shapecheck.mjs` and `repro/shape-scenes/`.
- Not the draw, bake, feed or Time pass shaders, `sculpt.py`, H8's parts
  of `sculpt.js`, or the JS engine itself.

**Budget:**
- Item 1 is a stop point.
- After it, each option is its own commit.
- If the budget runs short, stop once Desert, Red and Moon run on the GPU
  (Desert's cause, the cross-section, water mask choices, base options,
  hill lobes and ridge options), with NOTES.md saying what remains.

**Server and guard:**
- port 8874, CDP 9674;
- worktree `../terraform-wt-H9`, branch `H9-shape-options`;
- assets `$R/agent-H9`, with `mapcheck.mjs` copied from `$R/agent-H4`;
- baseline `$R/repro-out/merge-h6c`;
- guard `--worlds none`.

**Done (merged as a7c2256; EXPERIMENTS row 153; notes in
`$R/agent-H9/NOTES.md`).**
- **Desert's cause.** Desert's world knobs set `baseVary` 36 and `baseBump`
  3.5, which the GPU refused on every stroke. A refused node goes straight
  to the JS engine in `addNode`, so no reason was recorded. `addNode` now
  records it. The coordinator's first census also missed archipelago-1:
  its five shallow strokes set `waterDeep`.
- **On the GPU now,** each in its own commit with a scene in
  `repro/shape-scenes/`:
  - the base options and `moonLobes`, as one shared `outlineShift` and
    one `baseBump`, each fed by its own knobs (decision 14; the knobs are
    not merged);
  - the parametric cross-section, on every kind but `deep`. A hill with a
    profile or ridge options is the plain swept hill, as in JS;
  - shape mask writes and water mask choices, as one extension of the
    mask-write list;
  - ridge options (crest jag, vary, taper, spurs);
  - crater rim spurs, sectors and gaps.
- **`shapecheck`, GPU against JS, max |Δh|,** on a 4×4 map: base options
  .0001; cross-section .0001 (Desert's section .84 on 0.003% of cells);
  mask writes .0003, with one mask cell one step off; ridge options up to
  1.15 on 0.6-1.2% of cells; crater rim .41.
  - **Correction (H8b):** the study figures, which were 0 for every
    option, were void. With `gpuShape=1` in the address, `shapeCompare`
    ran the GPU on both sides, because `gpuShapeOn()` reads the address
    first. H8b fixed the check (084609c on its branch). Corrected, the
    study shows the same gaps as the map: ridges 1.07, Desert's section
    1.05, crater rim .42, deep section 4.0. The 4×4 figures were real.
- **Fixed on the way:** a ground node in a map scene threw in the
  point-read scan (on main since H6c).
- **The census after the merge** (every stroke of the 27 scenes with
  `engine=1&gpuShape=1`): every stroke of Green, Archipelago, Zhon, Desert and Moon runs on the GPU, and all of Red's but red-3's one deep cross-section. Lava stays on JS (the coast pass on every stroke, and `hillLobes`), and so do Crystal's and Ice's columns and bergs, fingers, bank and plates, and crater facets.
- **Merge checks:**
  - The study at the defaults: the eight other worlds are exact against
    `merge-h8`. Green moves 45 pixels on green-1 and 10 on green-3 (mean
    |diff| 0.00): the compiler-order false alarm (ground rule 3). With
    every new branch replaced by `false`, both match exactly.
  - `regional.mjs` finds 0 on all 27, and on the ten Red, Moon, Desert and
    archipelago-1 scenes with `engine=1&gpuShape=1`.
  - Paged against whole-map: 0 of 31 planes differ on five scenes. Every
    option is positional, so the page ring is unchanged.
  - 4×4 exports with `gpuShape` 1 against 0: red-2 differs in 1 height of
    17,680 (by 1) and no tile index. moon-2 differs in 16 heights (by 1)
    and 1,086 tile indices, a reordering by the tile dedup.
- **Counts.** GPU shape lines 808 → 997, and shape uniforms 82 → 130, as
  the JS options moved over. The JS they replace goes in the retire card.
  Fallback reasons: 16 → 11.

**Still open** (H8b):
- **A deep stroke with a cross-section** is exact on the study but off
  by 4.0 on about 120 cells of a 4×4 map. It stays on JS (the coordinator
  added the refusal at merge); three cycles did not find the cause.
- **The 4×4 gaps** of ridge options (1.15), crater rims (.41) and
  Desert's section (.84 on 0.003%) miss the card's .001. The JS engine's
  own entry paths disagree by about .16 for ridges and spurs; the GPU
  equals the replay path `shapecheck` uses.
- **`hillLobes`** stays on JS (budget). Only lava-3 uses it, and Lava
  stays on JS for the coast pass; the owner is asked whether to drop it.
- **Still on JS by design:** Lava's coast pass; Crystal's columns and
  bergs, fingers, bank and plates, and crater facets; Ice's plates,
  fingers and columns. Shores and Bodies rebuild them.

**Done (merged as 2be97b1; EXPERIMENTS row 154; notes in
`$R/agent-H8b/NOTES.md`).**
- **The JS reference in `shapecheck` is real** (084609c). H9's study
  figures were void.
- **Ridge pieces** now scale the outline wobble and reach box by the
  piece's mean width, as `dab()` does in JS. Study max |Δh|:
  - crest vary .67 → .0003;
  - crest taper .67 → .0002;
  - spurs 1.36 → .0002;
  - moon-ridge 1.07 → .0010 (.0009 on 4×4);
  - crater rim .42 → .0002.
- **The deep lip.** In f32, `base − v` rounded to 0 at the first dry cells
  past the lip inset, so the stamp skipped them and lost the lip. Those
  cells now keep a vanishing weight, and the deep cross-section runs on
  the GPU.
  - red-section: 45 clusters → 3 isolated cells.
  - 4×4: about 120 cells → 4 isolated cells in 1.4M.
- **The flow bake** waits for the GPU heights (`shapeSettled`).
  `flowbake` nodes are skipped by the passes, and their stored planes are
  copied back in (`applyBakes`). Zhon keeps its rivers, with plane sums
  equal to JS.
- **`gpuShape` 1 in every preset** (`LIGHT_PASS`). A world with Material
  weathering above 0 (Archipelago) takes the unfed Time pass.
- **The regional check** uses the JS check for scenes the passes refuse,
  and skips the flow planes in the GPU check.
- **Study at the new defaults, against `merge-h9`:**
  - mean |diff| at most .0010 (desert-1 and desert-3: 43 and 45 single
    pixels);
  - Green exact; replay mismatch 0 and `regional.mjs` 0 on all 27;
  - with `engine=0`, exact against `merge-h8-e0`.
- **Maps.**
  - 4×4 exports of scene 2 of Red, Moon, Archipelago, Desert, Lava,
    Crystal and Ice pass their self-checks.
  - 8×8 Moon through pages exports in 7.8 s.
- **Speed** (`perf.mjs`, `gpuShape` 1 against 0):

  | Map | Load to final | Drag p95 | Release |
  | --- | --- | --- | --- |
  | Red 4×4 | 771 against 3,547 ms | 16.8 against 383 ms | 652 against 2,722 ms |
  | Red 8×8 | 1,502 ms | 16.8 ms | 1,002 ms |
  | Moon 8×8 | 685 ms | 16.8 ms | 584 ms |
  | Archipelago 4×4 (unfed, for the material field) | 2,238 against 3,793 ms | 167 against 333 ms | 2,503 against 2,253 ms |
- **Coordinator's merge checks:**
  - the 27 renders round to 0.00 against `merge-h9`. The largest changes
    are single pixels, invisible at 4× (red-3 33 pixels, desert-1 43);
  - `regional.mjs` finds 0 on all 27;
  - the 4×4 green-2 export's TNT heights, features, tiles and indexed
    picture are identical;
  - the census: the only reasons left are H10's (the coast pass, water
    fingers, bank and plates, crystal columns and bergs, crater facets)
    and the dropped `hillLobes`.

**Still open:**
- **The material field on the fed and paged pass** is not wired. It needs
  a GPU-height form of `materialField`. Archipelago's maps take the unfed
  pass (drag 167 ms), and its maps over 1168 samples carry no field.
- **Shape card:** Desert's section keeps 5 cells about .84 off, and the
  deep section 4 isolated cells.
- **zhon-1's protection plane** is .035 from JS in `shapecheck`. It was
  not looked into; the river tools go in H12.
- The counts table was not produced; H12 reports the full one.

### H10. The last shapes on the GPU

> **Owner, 2026-10-30:** "Then ASAP I would like to have everything use
> the GPU in the UI so we can delete all the CPU work and get on one
> single path ... I do not want to worry about back compat." "We want a
> similar look, tiny changes in height or shape or shading due to the GPU
> math are acceptable."

Read TERRAIN_ENGINE decisions 14 and 17-19, "Migration" (phase 1) and
"Rules for the cards". Then read H9's and H8b's Done and Still open lists,
and in `$R/agent-H6c/NOTES.md` the inventory lines on the options that
stayed on JS.

**What is there today.** After H8b, every world's preset runs the GPU
shape. A scene still falls back to the JS engine as a whole when a stroke
uses one of these options:
- **the coast pass** (`fingerCoast`, `shoreLayers`): `stampCoastShore` in
  `sculpt.js`, about 300 lines. It runs a connectivity flood and distance
  transforms over the prefix. Every stroke of Lava's three scenes uses it;
- **water fingers, bank and shore plates** (`fingers`, `bankPx`,
  `shorePlates`): `fingerRibs` and `fingerShift` read the coast;
  `stampShorePlates`, `Slabs` and `Frost` take a coast distance transform
  of the prefix. Crystal and Ice use them;
- **crystal columns and bergs** (`crystalForm`), about 140 lines. Crystal
  and Ice use them;
- **mountain and crater facets** (`iceFacets`, `craterFacets`). They read
  ±3 cells of their own result. Crystal and Ice use them;
- **`hillLobes`.** Dropped (decision 17); H12 deletes it. Do not port it.

**Scope.**
- GPU versions of these options, judged by look, not by bits
  (decision 17). A GPU-shaped model may replace the JS algorithm.
- **Share:** one coast distance field on the GPU, computed from the
  prefix by jump flooding, for example. The coast pass, fingers, bank and
  plates all read it. It is also where the Shores feature card starts.
- The JS engine is not edited; H12 deletes it.

**Deliver.**

1. **Inventory (a stop point).** For each option, hand back:
   - what the JS does;
   - the GPU model you propose and what it reads;
   - its reach, for the page ring or a window of its own;
   - its expected cost;
   - the scenes that use it.

   Add the order.
2. **The coast distance field,** a shared pass, at both resolutions.
3. **The coast pass, fingers and bank** on it.
4. **Shore plates.**
5. **Crystal columns and bergs.**
6. **Facets,** as a pass over the node's own result.
7. **The census:** every stroke of the 27 scenes runs on the GPU.
   `hillLobes` is the only reason left (lava-3).
8. **Maps.**
   - 4×4 exports of Lava, Crystal and Ice: self-check, no seams at 2×.
   - 8×8 Lava through pages.
   - `perf.mjs` on Lava at 4×4.

**Acceptance.**
- **The same look** on Lava, Crystal and Ice against `merge-h8b`, which
  still draws them with the JS engine:
  - triptychs by eye at 1× and 2×;
  - `stats.py`: no metric leaves the world's retail range where
    `merge-h8b` was inside it.
- **The other six worlds** are exact against `merge-h8b`.
- **`regional.mjs`** finds 0 on all 27.
- **The gate** passes.

**Files:**
- `engine-shape.wgsl`, and a new `engine-coast.wgsl` if you want one;
- `sculpt-gpu-fields.js`;
- in `sculpt.js`, only `shapeContext` and the probe-stroke parameters;
- `repro/shape-scenes/` and `repro/` tools.
- Not the draw, bake or bridge shaders, and not the JS engine.

**Budget:**
- Item 1 is a stop point.
- If the budget runs short, go in this order and stop at a finished one:
  the coast pass (every Lava stroke), plates, columns, facets.

**Server and guard:**
- port 8876, CDP 9676;
- worktree `../terraform-wt-H10`, branch `H10-last-shapes`;
- assets `$R/agent-H10`, with `mapcheck.mjs` and `refusals.mjs`;
- baseline `$R/repro-out/merge-h8b`;
- guard `--worlds lava,crystal,ice`.

**Done (merged as eb99479; EXPERIMENTS row 155; notes in
`$R/agent-H10/NOTES.md`).** Four agents in turn: the inventory and steps
1-2; the coast field, layers and fingers; plates, columns, bergs, facets
and the drops; the page ring and the 8×8 numbers.
- **Finding 0.** `nodeSupport` refused the coast pass for every kind,
  because Lava's defaults set it, but JS runs it only for water strokes.
  Gating the refusal by kind freed every Lava hill and plateau with no
  port. lava-1's shallow refusal was the default `bankPx` 60, not fingers.
- **On the GPU now:**
  - the dry bank (`bankPx`) in the stamp, its region included (a ring at
    the region edge was 17.7 off before that fix);
  - one coast distance field: jump flooding on crossing points, in world
    px, kept in the existing `Sc` scratch (14 planes, only for node lists
    with a coast node). Against the JS eikonal on one lake: max 2.2 px,
    p95 1.8 px. The GPU distance is Euclidean; the JS one runs slightly
    long;
  - coast layers (steps and scallops) and coast fingers (thumbs). The
    finger flood is replaced by a march back along the normal (decision
    17). It cuts 44 more cells at finger tips on lava-fingers (0.02%); by
    eye, no floating or cut-off fingers;
  - shore plates (slabs and frost) on the same field;
  - crystal columns (each cell reads its 3×3 lattice neighbours) and
    bergs (a host-built plane list, as for pyramids);
  - crater and mountain facets.
- **`shapecheck`, GPU against JS:** layers max 2.1 (0.4% of cells over
  .5); fingers and scallops max 58-119 on 0.03-0.6% of cells, in clusters
  at finger and inlet edges (0.1% over 1 on a 4×4); plates 0.2-1.7% of
  cells over .5, at the band edge; columns exact; bergs and facets max
  .0004. Masks and marks: 0 cells.
- **Drops (owner, decision 20):** dab fingers with the ribs path, plate
  material 0, layer style 2 and hill facets. `fingerCoast` and
  `fingerBlunt` are gone (fingers always join the coast), and
  `plateMaterial` defaults to 1. The JS engine pins the old values until
  H12 deletes it.
- **The page ring.** The old rule summed each coast node's read radius
  along overlapping nodes: 640-1024 cells for lava-1 on an 8×8.
  - Forced rings on lava1-8: 1 plane differs at 64, none at 128-320.
    Chains of 8 and 12 lakes behave the same.
  - `ringNeed` now follows the engine's rectangles per page. A coast
    node's reach counts once, and each further link adds the field's blur
    margin. Layers never move a cell across sea (read from the shader).
    The per-link margin is a supported inference: 0 planes differ at 128
    where the rule picks 192.
  - Paged = whole on 31 planes for lava1-8 (ring 192), lava2-8, ice1-8,
    crystal1-8, crystal2-8 and green-2. `RINGS` stops at 320 (74 MB of
    scratch a page).
- **8×8 (`perf.mjs`):** load Lava 1.37 s, Crystal 1.12 s, Ice 2.13 s;
  drag p95 16.7-16.8 ms; heap at most 149 MB, GPU at most 615 MB. Green
  0.86 s against 0.84 s on main. On main the JS path never drew Lava,
  Crystal or Ice at 8×8 (drags of 69-136 s, no picture).
- **Coordinator's merge checks:**
  - the 27 renders equal the agent's. Against `merge-h8b` only Lava,
    Crystal and Ice move: mean |diff| .15-1.00, lava-1 4.7% of pixels,
    ice-1 3.1%. The other six worlds are 0.00;
  - by eye at 4×: the same coasts, fingers, slabs and floes. Lava's
    terraces read a little softer, because JS blends the risers within a
    cell. Accepted under decision 17 and shown to the owner;
  - `stats.py` on Lava, Crystal and Ice: no metric newly outside its
    retail range; ice-1's 0.30-0.50 slope share came back inside;
  - `regional.mjs` finds 0 on all 27;
  - the 4×4 green-2 export's TNT heights, tiles, features and indexed
    picture are identical. lava-1, crystal-2 and ice-1 4×4 exports pass
    their self-checks;
  - the census: one refusal in the 27 scenes, lava-3's `hillLobes`.
- **Tools.** `$R/agent-H4/mapcheck.mjs` draws a Green map whatever the
  scene; `$R/agent-H4/mapcheck-biome.mjs` (H10's `mapcheck2`) takes the
  scene's world. `$R/agent-H10/coastcheck.mjs` compares the coast field.
  `render.mjs` attaches to the first page on its CDP port, so two runs
  must never share one.

**Still open:**
- A chain that needs more than the top ring still hands the map to the JS
  engine. Example: 16 overlapping 1200 px Smooth strokes, then a lake,
  need 412 cells (`$R/agent-H10/pb/smooth16.json`). H12 clamps instead.
- Lava's terraces at 4×: a half-cell riser blend would bring them closer
  to the JS look, if the owner asks.
- The material field on the fed and paged pass (from H8b): H12.
- Desert's section cells and zhon-1's protection plane (from H8b) are as
  they were.

### H12. One path

> **Owner, 2026-10-30:** "Then ASAP I would like to have everything use
> the GPU in the UI so we can delete all the CPU work and get on one
> single path that we can then optimize and move forward with. I do not
> want to worry about back compat or drag two render paths along with us.
> This is still an early stage project."

Read TERRAIN_ENGINE decisions 16-20, "Migration", "Combine or drop" and
"Rules for the cards". Then read H8b's and H10's Done and Still open
lists.

**What is there today.** After H10, every stroke of the 27 scenes runs on
the GPU shape; the census's one refusal is lava-3's `hillLobes`. Every
world draws with engine 1 and runs the GPU Time pass, and maps over 1168
samples page. The CPU paths are still in the tree, reached by switches,
fallbacks and the checks against JS:
- engine 0: `sculpt-frag.wgsl` (2,246 lines), `relief-bake.wgsl` (1,260),
  `sculpt-common.wgsl` (715), `erosion.wgsl` (235) and
  `material-model.wgsl` (123), and the renderer's engine-0 branches;
- the JS shape engine in `sculpt.js` (4,382 lines in all): `applyNode`,
  `dab`, the stamps, the coast pass, the prefix snapshots, and
  `shapeDefaults` pinning the dropped finger options;
- the CPU workers: `sculpt-weathering.js` (363), `sculpt-tiled-weather.js`
  (318), `sculpt-sand.js` (150), `sculpt-material-weathering.js` (184) and
  `sculpt-map-weather.js` (35);
- the River and Source tools with the flow bake: `sculpt-flow.js` (350)
  and `sculpt-flow-ui.js` (387), and their strokes in zhon-1..3;
- the switches: `engine`, `gpuShape`, `gpuFeed`, `gpuPages`,
  `materialModel` and `quarterFirst`;
- the fallbacks: a refused node, a page chain over the top ring, and
  Archipelago's unfed Time pass (the material field is not on the fed
  pass).

**Deliver,** one commit per group, in this order. Update NOTES.md after
each commit, so that a successor can continue from it.

1. **Inventory (written, not a stop point).** For each group: its files
   and lines, every caller left after the deletion, and the knobs only it
   reads. Stop and report only if something the editor needs exists only
   on a CPU path, with no GPU twin.
2. **The material field on the fed and paged pass:** a GPU-height form of
   `materialField` (H8b's Still open), so that Archipelago takes the fed
   pass. Archipelago's 4×4 drag p95 must reach the frame cap (167 ms
   unfed). Judge the look against `merge-h10` (decision 17).
3. **The page ring clamp.** A chain over the top ring clamps to 320 and
   logs one console warning, with no JS fallback. Show it on
   `$R/agent-H10/pb/smooth16.json`.
4. **The switches and fallbacks.** The GPU path becomes unconditional;
   remove the readers of the URL parameters.
5. **Engine 0:** its shaders and the renderer's branches.
6. **The JS shape engine,** `hillLobes`, the URL-only experiments
   (decision 17), and every knob only they read. `shapecheck.mjs` loses
   its JS reference: keep it as a GPU repeat and paged-against-whole
   check, or delete it.
7. **The CPU workers.**
8. **The River and Source tools with the flow bake** (decision 19), and
   their strokes in zhon-1..3. The Zhon scenes change: judge them by eye.
   `$R/repro-out/merge-h12` becomes the baseline at merge.
9. **The simplification report** against 467c744 and 843b7fc: shader
   lines, uniforms, knobs, CPU worker lines, `sculpt.js` lines and the
   files deleted.

**Keep:** the TA output's packaging (TNT, tiles and the archive; decision
18), the Python material preparation (until the Materials card), the
bridge, `regional.mjs` and the export self-checks.

**Acceptance:**
- every scene the same as `merge-h10` (`compare.py` 0.00), except
  zhon-1..3 without their rivers and Archipelago's material field (a
  similar look, by eye at 1× and 2×);
- `regional.mjs` finds 0 on all 27; paged = whole on 31 planes for
  green-2 and lava1-8;
- the 4×4 green-2 export identical to `merge-h10`'s; a 4×4 export of one
  scene per world passes its self-checks (`mapcheck-biome.mjs`);
- 8×8 Green, Red, Lava, Crystal and Ice load, drag and release no worse
  than `merge-h10` beyond noise; Archipelago's 4×4 drag at the frame cap;
- the editor works with no CPU path: load each world, paint with each
  brush, undo, export and page an 8×8, with a clean console throughout;
- `repro/gate.sh` passes, and no removed switch is read anywhere.

**Budget:** if it runs short, stop at a finished group, with NOTES.md
current; a successor continues.

**Server and guard:**
- port 8877, CDP 9677. Never share a CDP port between runs;
- worktree `../terraform-wt-H12`, branch `H12-one-path`;
- assets `$R/agent-H12`;
- baseline `$R/repro-out/merge-h10`.

**Part 1 done (merged as bfabbab; EXPERIMENTS row 156; notes in
`$R/agent-H12/NOTES.md`).** Groups 2-8, by two agents. The branch deleted
8,215 lines and added 292.
- **The material field on the fed and paged pass.** `materialField` takes
  the Time pass's eroded-height buffer and returns a GPU buffer, which the
  chunk feed writes into grid layer 1. Each drop starts from a world-cell
  hash, so pages join. Archipelago takes the fed pass: 4×4 drag p95 166.7
  → 16.8 ms. Its scenes move by mean |diff| .03-.09; paged against whole
  on a 4×4 is a speckle ring of .33 around one hill, with no seams.
- **The page ring clamp.** A chain over the largest ring that fits the GPU
  budget clamps to it with one console warning and never errors.
  smooth16 at the default `gpuMB` 512 draws at ring 192; at 2048 it draws
  at 320. Lava 8×8 still pages at the default budget.
- **Gone:**
  - the switches `engine`, `gpuShape`, `gpuFeed`, `materialModel` and
    `quarterFirst`, and their fallbacks. `nodeSupport` is deleted: a node
    the passes do not draw draws nothing. `gpuPages=force`, `pageRing` and
    `timeApron` stay as test hooks;
  - engine 0's five shaders (4,579 lines) and the renderer's engine-0
    branches;
  - the CPU workers (1,050 lines). `erosion` 0 means "Weathering off";
  - the River and Source tools, the flow bake, `FLOW_BAKE.md` and their
    strokes in zhon-1..3;
  - `sculpt-fields.js`, `hillLobes` with `hillSteps` and `lavaTread`, the
    URL-only experiments, and 767 dead lines of `sculpt.js`.
- **Checks (the agents', then the coordinator's after the merge):**
  - all 27 scenes `"mismatch":0` with a clean console; against
    `merge-h10`, 0.00 except Archipelago (.03-.09), lava-3 (1.20, the hill
    lobes) and zhon-1..3 (5.9-7.0, the river tint and bank stain gone,
    geometry unchanged by eye);
  - `regional.mjs` 0 on all 27; the 4×4 green-2 export's indexed picture
    is byte-identical to `merge-h10`'s; the gate passes.
- **Learned:** an exception inside a shape pass is swallowed, and the
  scene renders flat with a clean console. H12b makes errors surface.

**Part 2: H12b, below.**

### H12b. Retire the study

> **Owner, 2026-10-30 (decision 21):** retire the 1024-px study view; the
> editor always works on a map.

The study, `/sculpt` with no map size, still previews strokes with the JS
engine and draws from CPU copies of the terrain, and the 27 scenes render
through it. Without it the JS shape engine has no caller.

**Deliver,** one commit each:
1. `repro/render.mjs` renders a scene as a 1024-px window on a map, with
   the same outputs, and also runs against main. A baseline from main
   (`base-main-map`) shows the study-to-map look change.
2. `regional.mjs` and `shapecheck.mjs` on a map.
3. `/sculpt` opens a default map.
4. Delete the study, its pointer handlers, the JS shape engine, the
   whole-image draw, the CPU readback of the Time pass and `materialRule`.
5. Exceptions in the shape and Time passes reach the console and the
   editor's error line.
6. The dead `uReliefMode` branches go.
7. The simplification report against 467c744 and 843b7fc.

**Acceptance:** H12's list, with `base-main-map` as the baseline (0.00 on
all 27), and a smoke run that opens `/sculpt` on its default map.

**Server and guard:** port 8877, CDP 9677; worktree
`../terraform-wt-H12b`, branch `H12b-study`; assets `$R/agent-H12b`.

**Done (merged as e08ebd7; EXPERIMENTS row 157; notes in
`$R/agent-H12b/NOTES.md`).** Two agents. Phase 1 (decision 18) is
complete: the editor has one stroke path and one draw path, both on the
GPU.
- **Scenes on a map.** `repro/render.mjs` plays a scene on a 4×4 map at
  offset 0 with the map's sea and crops the 1024-px window. The first try
  shifted the strokes by 528 px, which moved every position-dependent
  noise and gave mean |diff| 16-40 against the study; at offset 0 it is
  0.9-7.5 (crystal-2 7.45, green-2 5.50, the rest 4 or less), the same
  forms with a different grain, since the map's Time pass runs over the
  whole map. The sea barely matters (only green-2 moves, 5.50 to 4.62).
  Accepted by the coordinator under decision 17. `stats.py`: three marks
  newly outside, all at a boundary (green-3 `band_32px` 3.33 → 3.35,
  crystal-2 `band_8px` 6.28 → 6.37, ice-1 `slope_0.30-0.50` .121 → .126,
  the last one in again at H10 and out again now); about 20 went back in.
  The new baseline is `$R/repro-out/merge-h12` (from main before this card:
  `$R/agent-H12b/base-main-map-b`).
- **`regional.mjs` and `shapecheck.mjs` on a map.** The regional check
  compares four quadrant runs with the paged fields, plane by plane
  (`gpuPages=force`). A negative test (one height +1 in one quadrant) is
  caught: "1 regional field samples differ".
- **`/sculpt` opens a 4×4 map** when the address has no size.
- **Deleted:** the study and its pointer handlers, the JS shape engine
  (`startStroke`, `dab`, the stamps, the helpers), `studyShape`, the demo
  scenes and the Example select, the frame loop and the whole-image PNG,
  `renderer.erode` and `GpuErosion.run`, `materialRule`, the CPU study
  arrays, `regionalReplay`, the raster nodes and the old sketch loaders.
  `sculpt.js` 3,334 → 1,577 lines.
- **Errors surface.** A failed shape run, copy, fill or page read, or a
  failed Time pass, goes to the console and the editor's error line. A
  shape run that kept failing used to freeze the page (the weather queue
  re-asked in a loop of resolved promises); it now fails with the error.
- **`uReliefMode`** and the lab look's shader branches are gone.
- **`repro/smoke.mjs`:** each world on the default 4×4, every brush adds
  one node and undoes it, export (Zhon disabled by design), and one 8×8
  stroke and undo, with a clean console.
- **The simplification report:**

  | Measure | 467c744 (baseline) | 843b7fc (H6c) | H12 part 1 (bfabbab) | H12b (e08ebd7) |
  | --- | --- | --- | --- | --- |
  | Shader files / lines | 4 / 4,002 | 14 / 10,308 | 10 / 6,995 | 10 / 6,992 |
  | Uniforms | 350 | 375 | 376 | 375 |
  | Knobs, total / Green | 400 / 79 | 430 / 76 | 417 / 74 | 417 / 74 |
  | World-preset entries | 429 | 426 | 421 | 421 |
  | CPU worker files / lines | 9 / 2,050 | 9 / 2,068 | 0 / 0 | 0 / 0 |
  | `sculpt.js` lines | 4,017 | 4,326 | 3,334 | 1,577 |
  | JS files / lines | 16 / 8,234 | 19 / 10,425 | 10 / 7,682 | 10 / 5,750 |

  The run-time path and the JS got simpler: one path, no CPU workers,
  `sculpt.js` −61% and the JS −45% against 843b7fc. The shaders, uniforms
  and knobs did not: they are close to the baseline's counts because the
  engine replaced engine 0 one for one. That is phase 2 and 3's work (the
  feature cards, then combine or drop).
- **Coordinator's merge checks:**
  - the 27 renders: `"mismatch":0`, clean consoles, 0.00 against
    `base-main-map-b` on all 27;
  - `regional.mjs` 0 on all 27 (on the map, grid 1168);
  - the 4×4 green-2 export's TNT heights, tiles, features and indexed
    picture are identical to `merge-h10`'s;
  - `smoke.mjs --page8` on 8801: nine worlds, 15 brushes each add one node and undo, exports ok (Zhon disabled by design), one 8×8 stroke and undo over 5 pages, every console clean;
  - the gate passes.

**Still open:**
- **Lava and Ice 8×8 at the default `gpuMB` 512** raise "chunk needs 537
  MB (Ice 545 MB) of GPU memory; use chunks of 256 px or smaller". Main
  raised it too, but only into the error line; it is logged now. The
  picture finishes. The 8×8 GPU peak (540-615 MB) is over the budget: a
  budget or chunk-size card.
- The knob audit was static and by name; `sculpt.py` comments still name
  the study (about lines 206, 312 and 455); `perf.mjs` keeps dead `isMap`
  branches.

### H13. GPU memory on 8×8 maps

> **Owner, 2026-10-31:** go, as the small card before phase 2.

Lava and Ice 8×8 at the default `gpuMB` 512 raise "chunk needs 537 MB (Ice
545 MB) of GPU memory; use chunks of 256 px or smaller". The picture
finishes, and the 8×8 GPU peak is 540-615 MB. Raising the default is not
the fix.

**A lead, to verify first.** `sculpt-canvas.js` fixes the chunk size once,
while `recommendedChunkSize` is recomputed on every `setBudget` as the
reserve (cache and copies) grows. `allocate()` compares `required`, which
includes `reservedBytes`, with the whole budget and throws when the
canonical chunk no longer fits. That the picture finishes suggests the next
round evicts and retries.

**Deliver,** one commit each:
1. Log `estimate()`'s parts at the throw (fixed, reserved, field, input,
   mesh, output). Say why Lava and Ice cross and Green does not.
2. Make the first allocation do what the recovery does: reserve the
   canonical chunk's working set in the eviction threshold, or evict before
   allocating. No hardcoded layer counts; Materials will change them.
3. `smoke.mjs --page8` takes a world list, so it can run Lava and Ice.

**Acceptance:** 8×8 Lava and Ice at the default budget with a clean console
and a GPU peak within the budget; Green 8×8 unchanged; the 27 scenes 0.00
against `main-ab9a80f`; `smoke.mjs --page8` clean.

**Server and guard:** port 8879, CDP 9679; worktree `../terraform-wt-H13`,
branch `H13-gpu-budget`; assets `$R/agent-H13`. Files:
`sculpt-canvas.js`, `sculpt-chunk-renderer.js`, `repro/smoke.mjs`.

**Done (merged as fa83b11; EXPERIMENTS row 158; notes in
`$R/agent-H13/NOTES.md`).**
- **The cause.** The 512 px chunk was not too big: the paged fields had
  taken its room. On lava-1 at 8×8 it needed 537 MiB against 512, most of it
  the fields. Green pages at ring 4; Lava and Ice page at ring 192, where 6
  shape pages already cost about 240 MiB. Three faults:
  - `weatherBudget` was read once, so a refit's cap of 6 pages never held
    and a pan filled 22;
  - `minimumBytes()` left room for a 32 px chunk, not the canonical one with
    the world's mask layers;
  - `estimate()` counted 16 bytes a texel where `allocate()` makes 24.
- **Peaks** while loading and panning, in MiB against 512:

  | World | Before | After | Console |
  | --- | --- | --- | --- |
  | Lava | 517.8 | 504.6 | clean; it logged an error before |
  | Ice | 518.7 | 504.5 | clean |
  | Green | 377.3 | 377.3 | clean |

- **The cost.** Load is the same. A pan on Lava settles about 100 ms later
  (354 against 266 ms, median), since the image cache has less room and some
  chunks rebake. Ice and Green are the same.
- A refused chunk now names the parts of the estimate, and `smoke.mjs` takes
  `--worlds8`.
- **Coordinator's merge checks:** 27 scenes 0.00 against `main-ab9a80f` with
  clean consoles; smoke clean on nine worlds and on 8×8 Green, Lava and Ice;
  the gate passes.

**Still open:** the fit assumes 9 MB a weather page where one costs 5, so
the cap could be 14 pages, not 6. That would recover Lava's 100 ms.

### H14. Materials: every world from numbers

> **Owner, 2026-10-29:** "we should codify the retail information in some
> way that no longer requires it when running to keep things simple and
> allow for easy cloud development."
>
> **Owner, 2026-10-31:** go, Materials first of the phase 2 cards.

**The rule.** Every image the engine reads becomes a generated layer or a
uniform, made at startup from committed numbers. The bridge's *logic*
stays, gated as now, and reads `genColor` layers that are now made from
numbers: margins, beach, slate, transition. Shores, Bodies and Geology
delete that logic later. This card does not touch placement or knobs,
except where a knob only described an image.

**What is there today.**
- `materials/green.json` holds Green's four land materials (ramp, bands,
  tint, zq), its `ground` tile data and its placement rows.
  `engine-materials.wgsl` makes them at startup, 512 px and periodic with
  seven mip levels, in about 10 ms.
- The other eight bridge 28 prepared images into the same array
  (`bridgeCopy`, `BRIDGE_LAYERS`): 0 slope grass, 1 rock, 2 weathered,
  3 fractured, 4 fringe, 5 transition body, 6 beach, 7 mineral ring. Their
  placement rows are built from their knobs.
- All nine still read images for water (`water`, `waterMid`,
  `waterShallow`), `noise*`, `fractures` and `palette`. Six read
  `groundTiles`.
- `config.json` in each `assets-*` holds measured numbers (`material`,
  `water`) that are in no committed file.

**Deliver,** one commit per step and per world:
1. **Inventory.** For each world and each image: its role, whether the
   engine path reads it at all, and what replaces it. Images nothing reads
   go at once.
2. **The pipeline, Moon as the pilot.** `measure/material_numbers.py`
   writes `materials/<world>.json` in `green.json`'s layout, with the extra
   entries a world needs (fringe, body, beach, ring, ground tiles, the
   `material` and `water` numbers from `config.json`). `makeMaterials` makes
   N layers in table order for any world, and `MATERIAL_TABLES` lists the
   world. Moon's three windows are judged, and the card **stops for the
   coordinator's review** of the look.
3. **The section worlds:** Crystal, Ice, Lava, Zhon. One preparation made
   them, so one model should cover them.
4. **Red and Desert** (the structured family), **then Archipelago** (fringe,
   ring, body). H4 found that the noise model speckles where art has
   facets; use what H4 built for rock.
5. **Water** as numbers, colour by depth (`measure/water_fit.py`), Green
   too. **Noise** made at startup. **The palette** as a table with its
   lookup built at startup. `fractures.png` is ours, not retail: move it to
   startup if that is cheap, otherwise list it for the Fractures card.
6. **Delete:** `bridgeCopy`, `uBridged`, `BRIDGE_LAYERS`, the image URLs in
   the config, the Python material preparation, and the `shine*` keys that
   move into the tables. Update `sculpt-control-schema.js`, which is now
   the knob registry the UI reads. A server with no `assets-*` world images
   still draws every world.

**Where a material can't be made from numbers,** say which, measure the
gap, show it side by side and keep its image until the coordinator rules.
The gaps are counted in the Done list.

**Acceptance:**
- Each world on its three retail windows, by eye at 1× and 2× and by
  `stats.py` (rule 5). Zhon's reference is third-party, so it is judged by
  eye. A similar look is enough (decision 17). A mark newly outside retail
  by a boundary is reported, not chased.
- `regional.mjs` 0 on all 27; `smoke.mjs` clean; exports work.
- Load time and memory reported per world against `main-ab9a80f`.
- Counts: bridged images 28 → 0, Python preparation 3,044 lines → 0, or the
  listed gaps.

**Server and guard:** port 8880, CDP 9680; worktree `../terraform-wt-H14`,
branch `H14-materials`; assets `$R/agent-H14`. H13 merges first; merge main
before landing.

**Part 1 done (merged as 1fcaafd; EXPERIMENTS row 159; notes in
`$R/agent-H14/NOTES.md`).** Steps 1 and 2.
- **The inventory.** A default page load fetched 73 images across the nine
  worlds; it now fetches 69. Land images still read: 24 across seven worlds
  (Red 3, Desert 3, Archipelago 5, Crystal 3, Ice 3, Lava 3, Zhon 4). Every
  world also reads two waters, noise, the palette and fractures.
- **Dead code gone:** the `rock` key, `mineralRings`, the `rock` and `noise`
  variant branches, and seven textures uploaded but never bound. Dead images
  and keys that remain are listed in the notes.
- **The pipeline.** `measure/material_numbers.py` writes
  `materials/<world>.json`, which now also holds the `material` and `water`
  numbers that lived only in `config.json`. `makeMaterials` makes N layers
  in table order. Only a table with a `placement` block gives placement
  rows; the other worlds keep theirs from their knobs.
- **Moon draws no land image.** Its scenes move by mean |diff| 4.31, 1.66
  and 2.50, all on rims and walls, none on the plain. `stats.py`: 42 marks
  outside retail before and after, none newly outside. Ready after
  navigation is no slower. The generated pass takes 4-11 ms warm.
- **Moon's rock is the finding.** The swatch shows a soft cloud where the
  art has embossed facets (`$R/agent-H14/moon-sheets/swatch-1/rock.png`).
  The scenes barely show it, since relief shading and the palette carry the
  walls, and the coordinator accepted it. Ice, Crystal, Red and Archipelago
  would not get away with it: their shards, plates, cracks, veins and
  streaks are their look.
- **Provenance.** Ground tiles are sampled from neighbour statistics, so
  they are safe in a table. A quilted plain (Red, Archipelago, Crystal) is
  retail pixels and cannot go in one.
- **Coordinator's merge checks:** only moon-1..3 moved, by the agent's
  figures, and the other 24 scenes are 0.00; `regional.mjs` 0 on Moon's three
  and green-2; smoke clean on nine worlds, 8×8 Green and 8×8 Moon.

**Part 2: H14b, below.** It replaces steps 3 and 4. Steps 5 and 6 follow it.

### H14b. Materials as lit height fields

The art is rendered terrain: a height field lit from one direction, then
reduced to a palette. The noise model only matches its statistics, so it
makes a cloud where the art has facets. One generator should do what the art
did.

**Deliver,** one commit each:
1. **One generator** in `engine-materials.wgsl`: a height from the bands,
   with a ridged share and cells (facets with seams), at a stretch of any
   angle; lit from one direction; then through the measured rank map and
   ramp, so the histogram still comes out right. A shared overlay draws thin
   veins in their own colour. Every new number at 0 leaves a material as it
   is, so Green and Moon's slope stay 0.00. No knob per world.
2. **Measure and fit.** `material_numbers.py` adds the light direction,
   orientation and anisotropy, seam share, cell size, and vein width and
   spacing. `material_fit.py` fits them.
3. **A generated ground layer** for a quilted plain.
4. **Swatches, then stop for review:** Moon rock, Ice rock, Crystal rock,
   Crystal slope, Red's structured slope and Archipelago's mineral ring, each
   beside its prepared image, with no world switched.
5. **The worlds,** after review, one commit each: Moon's rock refit, Lava,
   Ice, Zhon, Crystal, Red, Desert, Archipelago. `MATERIAL_TABLES` lists all
   nine.

**Acceptance:** as H14, for each world. The generated pass stays under 100 ms
warm for a world's full set of layers. Quarter levels still read true.

**Server and guard:** port 8881, CDP 9681; worktree `../terraform-wt-H14b`,
branch `H14b-lit-materials`; assets `$R/agent-H14b`.

**Steps 1-4 done (merged as fe068a1; EXPERIMENTS row 160; notes in
`$R/agent-H14b/NOTES.md`).**
- **One generator** in `engine-materials.wgsl`, about 175 lines: bands on a
  sheared lattice, so streaks run at an angle and still wrap; a ridged share
  and a warp; Voronoi facets with seams; light from one azimuth; then the
  same rank map and ramp. A vein overlay draws zero-crossing lines. Five
  rows a material (39 → 44). A relief of 0 takes the old path, so no scene
  moved.
- **Coarse levels** of a lit layer are box means of the level above: a seam
  or vein softens and never vanishes.
- **A generated ground layer.** A table whose `order` ends in `quilt` holds
  a quilted plain. It is plumbed through `bridgeGround`, unused so far.
- **Tools:** `material_lit.py`, `lit_fit.py`, `lit_lab.py`, and `swatch.mjs`
  over the whole mip chain. The tables in `measure/lit-tables/` hold about 185
  numbers each.
- **Timing:** eight lit layers over seven levels take 34 ms cold and under 4
  ms warm, plus the one-time pipeline compile of about 400 ms.
- **The coordinator's review of the six swatches:**

  | Swatch | Verdict |
  | --- | --- |
  | Ice rock | Passes. Blue-white lit planes; only blockier than the art's diagonal shards |
  | Moon rock | Passes. Embossed grey rock; its discrete pits are missing |
  | Red's cracked slope | Passes. The same cracked rock; crevices a little less bold |
  | Crystal rock | Fails. Regular stained-glass polygons with grey cells, where the art has large irregular dark slabs |
  | Crystal slope | Fails. Corduroy stripes, where the art is mottled purple with fine hatching |
  | Archipelago's ring | Fails. Wandering contour lines and a vertical-streak artefact, where the art has short curved dark strokes |

- **Learned.** Statistics alone mislead here: Ice fitted Voronoi polygons
  whose numbers matched and whose picture did not. Fit, then judge by eye.
- **Coordinator's merge checks:** the 27 scenes are 0.00 against `merge-h14a` with
  clean consoles; `regional.mjs` 0 on moon-1, green-2 and crystal-1; smoke
  clean on nine worlds; 22 of 22 tests pass; the gate passes.

**Still open:** the development hooks `makeZ` and the `pad0` salt go in H14's
step 6. `ground=texture` on a table world still fetches an image, and
`means.ground` does not yet come from the table.

### H14c. The worlds on lit materials

**Fix the three failures first,** one commit each:
1. **Slabs.** Cells of uneven size with irregular outlines, seams of uneven
   width that open into black gaps, and tone that stays in the art's colours.
   Crystal rock reads as dark slabs, not stained glass.
2. **Streaks at fine scale only.** The stretch and shear fade with the band,
   so the broad bands stay isotropic and mottled. Crystal slope reads as
   hatching over blotches, not stripes. Its highlights and patchy cracks stay.
3. **Strokes.** The overlay gains short curved strokes with a dark core,
   placed per cell so they wrap, beside or in place of contour lines. Find
   the vertical-streak artefact and remove it. Archipelago's ring reads as
   strokes.

**If one still fails after honest tries,** stop and show the coordinator the
swatch. Its world stays on images until the owner rules, and the others go on.

**Then the worlds,** one commit each, each judged by rule 5 with the
acceptance of H14: Moon's rock, Ice, Lava, Zhon, Red, Desert, Crystal,
Archipelago. `MATERIAL_TABLES` lists all nine. Crystal's and Archipelago's
fringe, body and ring layers use the fixes above.

**Server and guard:** port 8882, CDP 9682; worktree `../terraform-wt-H14c`,
branch `H14c-worlds`; assets `$R/agent-H14c`.

**Done (merged as 703148c; EXPERIMENTS row 161; notes in
`$R/agent-H14c/NOTES.md`).**
- **The three fixes,** all by eye on swatches (`measure/lit-tables/`): slabs
  (`cellVary`: additive-weighted Voronoi, uneven cells with curved outlines),
  fine-scale streaks (`streakBand`: stretch and shear fade to isotropic above
  a band) and strokes (row 45: short circle arcs per lattice cell, cut into z,
  so the rank ramp makes pink with a dark core). The ring's vertical streak
  was the light showing the flat slope of value-noise edge columns at wide
  cells; `skew` slants the lattice in x so no edge stays vertical.
- **Moved,** by eye at 1× and 2× against retail and by `stats.py`. Mean
  |diff| is against `merge-h14b`, scenes 1, 2 and 3:

  | World | Mean \|diff\| | New marks outside retail | Reads |
  | --- | --- | --- | --- |
  | Moon's rock | 0.35, 0.25, 0.47 | none | as before; the slope stays unlit |
  | Ice | 4.31, 0.09, 2.35 | none | as before |
  | Lava | 0.04, 0.06, 0.19 | none | as before |
  | Desert | 1.17, 0.59, 0.94 | none | as before; its plain is a 32-colour tile strip, so tile letters run a-z then A-Z |
  | Zhon | 4.54, 2.57, 1.41 | none | sand, with a pink speckle at 2× that the old image and the reference lack; accepted by decision 17, H14d removes it |

- **Kept on images:**

  | World | Mean \|diff\| of the attempt | Why |
  | --- | --- | --- |
  | Red | 18.4, 17.5, 8.3 | The plain turns to red and olive salt-and-pepper. See H14d: the agent's reading (an ordered checker) was wrong |
  | Crystal | 20, 11, 19 | Slope and rock pass as swatches; the quilted plain goes grey and regular, and loses its bright streaks. Three new marks outside retail |
  | Archipelago | 7.6, 24.8, 27.3 | The islands change character: dark blobs with pale gaps, no pink ring. Not diagnosed |

  The attempts are in `$R/agent-H14c/` (`red-attempt/`, `crystal-attempt/`,
  `arch-attempt/`, sheets `sheets/*-attempt-*.png`).
- **The fixes are inert on main.** `cellVary`, `streakBand`, `skew` and the
  strokes are set by no committed world table, and the quilt-only plain
  plumbing in `sculpt-renderer.js` ran only in the three failed attempts.
  Crystal's slope and rock pass as swatches; Crystal itself is on images.
- **Cost.** A default load now fetches 5 images on a moved world (noise,
  water, shallow water, palette, fractures), down from 9-10; Red and Crystal
  fetch 9, Archipelago 11. Final in view is the same within 3% (Zhon 436 ->
  457 ms, the most). The generated array is 4 layers on Moon, Ice, Lava and
  Desert (5.6 MB against 11.2 by formula; `perf.mjs --only` did not capture
  memory) and 7 on Zhon (9.8 MB). Zhon's 7 layers take 2.8-4.5 ms warm.
- **Zhon's 244 s "boot" is `perf.mjs`, not the page.** Its ready loop runs
  1200 × 200 ms for an export button that Zhon disables by design, then falls
  through. Its load figures were taken after that wait. Listed under small
  leftovers.
- **Coordinator's review:** a table world now ignores `ground=texture`, which
  read a `quilt` mean no such table has (`ice-1` with it renders clean);
  `auto_zq.py` takes its work folder; `smoke.mjs --page8` no longer waits on
  Zhon's export, which it had never reached.
- **Coordinator's merge checks:** only the five moved worlds changed against
  `merge-h14b`, the other 12 scenes are 0.00, and all 27 consoles are clean;
  `regional.mjs` 0 on moon-1, ice-1, lava-1, zhon-1 and desert-1; smoke clean
  on nine worlds, exports included, and on 8×8 Green, Lava, Ice and Zhon; all
  nine ground patterns are offered; 22 of 22 tests pass; the gate passes.

### H14d. The art's dither, then the last three worlds

**The finding** (coordinator's measurement of the prepared images). The
plains did not fail for want of strokes or a parity number. The art is a
smooth colour reduced to the palette by error diffusion, so its hue is
dithered per pixel. A rank ramp ties hue to luma and cannot make that.

| Art | Chroma lag 1, x and y | (1,1) | (1,-1) | Box 8 / white |
| --- | --- | --- | --- | --- |
| Red plain | -.44, -.38 | +.25 | -.04 | .37 |
| Zhon beach | -.61, -.48 | +.25 | +.25 | .25 |
| Crystal plain | -.35, -.34 | +.13 | +.12 | 1.06 |
| Crystal slope | -.32, -.28 | +.15 | +.14 | 1.51 |
| Ice rock | -.29, -.27 | +.04 | -.01 | .79 |
| Moon rock | -.02, .00 | +.11 | +.11 | 1.87 |
| Archipelago plain | +.01, +.01 | +.01 | +.01 | 1.08 |
| *Floyd-Steinberg simulated at share .3* | -.43, -.42 | +.16 | .00 | .22 |
| *A 64 px blue-noise tile, thresholded* | -.25, -.25 | -.16 | -.09 | .32 |
| *A high-passed hash, thresholded* | -.22, -.21 | +.05 | | .70 |

- **Red's plain is not an ordered checker.** Pixel parity does not split its
  colours (total variation .012). Its red (111, 51, 59) and olive (107, 91,
  23) have nearly the same luma, so a luma rank scrambles them.
- **Moon's rock has no hue dither,** which is why it was easy.
- **A guess, to verify:** Crystal's grey cells and Zhon's pink speckle are
  this same fault, rank bins averaging or splitting dithered hues.
- **Archipelago's plain is white noise,** so its failure is something else.

**Deliver,** one commit each:
1. **One dither.** The ramp stays a smooth colour, and a threshold picks the
   final colour per pixel between palette colours. A number at 0 leaves a
   material as it is. Three forms, in this order, the first that reads right:
   - **The draw's palette stage first.** `palettePair` in `engine-frag.wgsl`
     already takes a smooth colour to two palette entries by a threshold
     (experiment 62, on for Desert). It runs after the light, as the art's
     reduction did, and it needs no generator step, so there is one dither
     and not two. Try a smooth ramp with `paletteMix` on. Its threshold is an
     ordered 4×4 in screen pixels, so check how it reads against the art's
     signature and whether it stays on the map in a pan. Experiment 62 found
     that a noise threshold clumped into speckles there.
   - **The mask in the generator.** Each ramp bin holds two colours and a share,
     measured by splitting the bin along its chroma axis, and a tiled
     blue-noise threshold picks between them. It is parallel and cheap. It
     gets the even spread and misses the art's pixel texture (the table).
   - **Error diffusion if the mask fails by eye at 2×.** One sequential pass
     at startup, wrapped so the layer stays periodic and within the 100 ms.
     Say what it costs.
2. **Zhon's beach,** the quickest proof: the world is on its table. The pink
   speckle goes.
3. **Red.** The plain, then its lattice of dark dots, measured. Red moves.
4. **Crystal.** Refit the plain with the dither; add bright streaks along the
   shear only if it still lacks them. Crystal moves. Its grey cells go.
5. **Archipelago.** The bridge reads the fringe's luma as a signal
   (`fringeSignal`, `fringeRange`, `stone`), not only as a colour. Compare
   layers 0, 4, 5 and 7 with the images as the bridge reads them, say what
   changed the islands, then fix it. Archipelago moves.

**If one still fails after honest tries,** it stays on images with its sheet
and the others go on. Step 6 of H14 cannot delete the bridge while a world
still reads it, so the coordinator takes any such world to the owner.

**Acceptance:** as H14, for each world. `MATERIAL_TABLES` lists all nine, or
the gaps are named. A world's layers stay under 100 ms warm. Quarter levels
read true: a box mean of a dithered layer should now give the smooth colour.

**Server and guard:** port 8883, CDP 9683; worktree `../terraform-wt-H14d`,
branch `H14d-dither`; assets `$R/agent-H14d`.

**Done (merged as b136359; EXPERIMENTS row 162; notes in
`$R/agent-H14d/NOTES.md`).** All nine worlds draw from numbers, and nothing
reads the image bridge.
- **The dither is real error diffusion, in the generator.** A material with
  `dither` above 0 keeps its ramp as the smooth colour, measured on bins of the
  blurred image (`material_numbers.py --dither`). `makeDither` then reduces each
  pixel to the nearest of the material's own colours, up to 16 (rows 46-61), by
  serpentine Floyd-Steinberg on rgb. Levels above 0 are box means. Row 62 is a
  lattice of dark dots, used by Red. A `dither` of 0 takes the old path.
- **The other forms failed first.** The draw's palette stage, tried first on
  Zhon, gives a regular checker of two entries (lag 1 -.66, (1,1) +.57 against
  the art's +.25), and the beach is a mix of three or four colours. One colour
  pair per ramp bin loses the pink and cream. The blue-noise tile was not built.
- **Blocks.** One invocation runs each 32 px square, and error does not cross
  its edge, so the layer wraps and blocks run in parallel. The edge is measurable:
  the chroma step across it is .57 to .70 of the step elsewhere, about 1 in the
  art. It is not visible, even low-passed and stretched fourfold
  (`$R/agent-H14d/grid/grid-red.png`).
- **Archipelago's cause was not the guess.** The transition-body flag was set
  only in the image bridge, so a table world skipped the shared transition (ring,
  body, contours) in `bridgeMargins`. It is a world flag now. Swapping each
  generated layer into the bridge changed nothing structural.
- **Coordinator's review.** The agent dithered Archipelago's slope and plain, but
  no layer of that art has hue dither (chroma lag 1 +.01 to +.24), and the dither
  took the plain's grain and the slope's flecks. They are undithered now, with
  the lit slope from `measure/lit-tables/archipelago-slope.json`.
- **A tool fault.** `material_numbers.py` wrote tile data for Crystal, and a table
  with `ground` draws the tiles, so no quilt change showed. It now writes tiles
  only when a world's default is not `ground=texture`.

- **The worlds,** by eye at 1× and 2× against retail and by `stats.py`. Mean
  |diff| is against `merge-h14c`, scenes 1, 2 and 3; dithered pixels never match
  bits, so these are large by nature. No mark is newly outside retail:

  | World | Mean \|diff\| | Marks outside | Reads |
  | --- | --- | --- | --- |
  | Zhon | 1.64, 1.05, 0.45 | 16 -> 16 | The beach's pink speckle is gone; the sand is yellower than the third-party reference |
  | Red | 17.46, 16.63, 7.98 | 13 -> 10 | Dots, tone and dither as the old image; the speckle a little less contrasty |
  | Crystal | 20.19, 11.09, 19.20 | 4 -> 2 | Direction, tone and contrast close |
  | Archipelago | 7.13, 20.01, 20.23 | 22 -> 22 | Ring, outlines and plain right; the interior is olive as in retail, with lit flecks |

- **Cost.** A default load now fetches 5 images on every world (noise, water,
  shallow water, palette, fractures) and no land image; feature sprites come on
  top. Final in view, ms, before and after: Red 667 -> 615, Crystal 557 -> 547,
  Archipelago 314 -> 308, Zhon 664 -> 652, and Ice, which has no dither, 416 ->
  405, so the second pipeline costs nothing measurable. A world's layers take 3.8
  to 12.7 ms warm and 15 to 31 ms cold. By formula, not measured, the array is
  1.4 MB a layer: 7 MB on Red and Crystal, 12.6 MB on Archipelago, against 11.2 on
  the bridge.
- **Lost:** the Ground pattern list goes from nine worlds to six. Red, Crystal
  and Archipelago have no tile data to lend, because their plains are quilts.
  A candidate for the combine-or-drop pass.
- **Coordinator's merge checks:** only the four moved worlds changed against
  `merge-h14c`, the other 15 scenes are 0.00, and all 27 consoles are clean;
  `regional.mjs` 0 on zhon-1, red-1, crystal-1 and all three of Archipelago's;
  smoke clean on nine worlds, exports included, and on 8×8 Green, Lava, Ice, Zhon,
  Red and Archipelago; `ground=texture` and `tiles` render on Crystal and Red; 22
  of 22 tests pass; the gate passes.

**Still open:** Crystal's streaks are straighter than the art's, with no bright
flecks. Red's slope facets are blocky. Zhon's raised dunes keep some pink, since
only its beach is dithered.

### H14e. Water, noise and the palette; the bridge goes

H14's steps 5 and 6. Every world is on a table, so the image bridge is dead
code. The deletions come first because they move no scene.

**Deliver,** one commit each:
1. **Delete the image bridge,** 27 scenes 0.00: `this.bridge`, `bridgeCopy`,
   `uBridged`, `BRIDGE_LAYERS`, the fringe, body and beach fetches,
   `bridgeGrassImage`. The logic in `engine-bridge.wgsl` (margins, beach, slate,
   transition) stays for Shores, Bodies and Geology. What it reads from the
   config's image names (`uBeach`, the transition flag, the fringe flag) comes
   from the table's `order`.
2. **Water** as numbers, Green too. Water and shallow water may simply be two
   more materials in the table, which on Lava are the molten surface.
   `measure/water_fit.py` is there for colour by depth.
3. **Noise** made at startup.
4. **The palette** as a table with its lookup built at startup. Only Desert has
   real pair rows: other worlds' pair lookup spans the whole palette, and Zhon's
   river variant names the 32-row image.
5. **`fractures.png`:** ours, not retail. Move it to startup if that is cheap,
   otherwise list it for the Fractures card.
6. **The rest of the deletions:** the Python material preparation
   (`sculpt_materials.py` and its neighbours), the `shine*` keys that move into
   tables, the image URLs in the config. Update `sculpt-control-schema.js`. The
   fitting hooks `makeZ` and `pad0` leave the engine; `measure/` still needs them,
   so `swatch.mjs` adds them to its own copy of the shader.
7. **A server with no `assets-*` folder draws every world.** Whatever the
   prepared `config.json` still supplies moves to a committed file. Feature
   sprites are retail art outside the repo; the owner has yet to rule on them,
   so a world draws without them.

**Acceptance:** as H14. Step 1 and step 6 are 0.00. The rest are judged on each
world's three retail windows. `regional.mjs` 0 and `smoke.mjs` clean on nine
worlds and on 8×8. Counts: images fetched at load, and lines of Python, before
and after. Where water or the palette cannot reach a similar look, keep its
image, show the sheet and go on.

**Server and guard:** port 8884, CDP 9684; worktree `../terraform-wt-H14e`,
branch `H14e-no-images`; assets `$R/agent-H14e`.

**Done (merged as c33bec2; EXPERIMENTS row 163; notes in
`$R/agent-H14e/NOTES.md`).** No world image remains, and the server needs no
assets folder to draw a world.
- **A fresh clone draws every world.** The coordinator cloned the branch and
  served it with stock Python (no numpy, no Pillow, no `.venv`) on an empty
  assets root. All 27 scenes matched the agent's final run at 0.00, with clean
  consoles. What such a server lacks: the feature catalogue and sprites (the
  Features tool says why, and starts stay editable), export (the helper is
  missing), and nothing else. Saved documents start empty.
- **The image bridge is gone,** 27 scenes 0.00. Which optional stages a world has
  (body, beach, ring) comes from its table's `order`, which the server passes as
  `config.layers`. The logic in `engine-bridge.wgsl` stays for Shores, Bodies and
  Geology.
- **Water is two more generated materials,** after the table's own layers, named
  by the `water` block (`deep`, `shallow`). Lava and Moon share one layer. Zhon's
  river variant carries its own pair. `measure/water_numbers.py` makes them.
  The first fit lost the diagonal ripple of the art, so the deep water of Green,
  Ice, Red, Desert, Archipelago, Crystal and Zhon's coast and the shallows of
  Green, Ice and Zhon are on the lit path. Their art has a direction; Lava, Moon
  and Zhon's river have none.
- **The noise is made at startup** (`sculpt-noise.js`, CPU): the four channels
  by seeded hashing and smoothing, with the mean, spread, quantiles and
  autocorrelation of the old image. It is a new realisation, so fine detail
  moved. Desert moved most: its pale caps and grey band follow the broad channel.
- **The palette lookup is made at startup** (`engine-palette.wgsl`, one compute
  pass from `materials/palette.json`), bit-identical to the image on Green and
  Desert. That file is 241 colours of the retail palette, committed as a table
  by the owner's rule that tables measured from retail art are fine. Desert's
  table names its 52 entries. The owner confirmed the table is fine in the repo
  (decision 22).
- **`fractures.png` stays an image.** All nine copies were byte-identical and it
  is ours (`measure/make_fractures.py` reads no retail art), so one copy in
  `materials/` serves every world. Listed for the Fractures card.
- **Deleted:** `ground_tiles`, `palette_pairs`, `sculpt_materials`,
  `sculpt_red_materials`, `sculpt_archipelago_materials`, `sculpt_rock_layers`,
  `sculpt_slope_material`, `sculpt_section_biome`; `config.json`; the
  `/sculpt-assets` route; `makeZ` and the `pad0` salt, which `swatch.mjs` patches
  into its own copy; `fringeStyle` and its control, which did nothing; the
  dead `ground=texture` toggle. No `shine*` key was ever in a `config.json`, so
  none moved.
- **Each world's page config comes from its table:** a `world` block (defaults,
  base height, colours, Desert's strata, the export's planet, sea level and
  climate) and Zhon's `river` block. Old and new configs were compared for nine
  worlds and the river variant: only the removed keys differ.
  `/map-catalog.json` is served from the tables.
- **Verdicts,** by eye at 1× and 2× against retail. Mean |diff| is against
  `merge-h14d`, scenes 1, 2 and 3:

  | World | Mean \|diff\| | Reads |
  | --- | --- | --- |
  | Green | 1.05, 3.63, 1.36 | as before; the diagonal ripple is back in the water |
  | Red | 0.23, 0.88, 10.68 | land as before; water gains a diagonal ripple it lacked, a little broader than the art's |
  | Archipelago | 4.89, 1.62, 2.25 | as before |
  | Moon | 1.97, 0.53, 0.89 | as before |
  | Zhon | 10.33, 11.72, 11.85 | as before; the number is the water's per-pixel dither. Coast water is in no window; one look by eye reads fine |
  | Lava | 3.66, 2.31, 4.00 | as before |
  | Desert | 9.94, 3.40, 7.63 | the pale caps and the grey band sit in different places on the same heights, the same in character |
  | Crystal | 2.72, 6.66, 2.93 | as before; a faint broad swell in the water |
  | Ice | 4.99, 9.12, 1.15 | land as before; the deep water's ripple has the art's direction and scale, but is more regular and a little stronger, and shows at 1× where the art's barely does |

- **Marks:** 118 lines carry a mark outside retail, before and after. Two
  noise moves on Red, both by a hair: `edge_vertical` red-1 .371 to .353 is
  newly outside, and `edge_diagonal` swaps (red-1 .486 to .499 goes out, red-2
  .497 to .480 comes in). Not chased.
- **Counts:** a default load fetches 1 image and the feature sprites, down from
  5 (Zhon has no sprites). Python in the repo root goes from 4,729 lines to 1,476;
  `measure/` from 5,490 to 5,817, since three tools arrive there. Engine lines:
  bridge 187, palette 74 (new), noise 110 (new, JS). One uniform and four bindings
  go, two uniforms arrive.
- **Cost.** Startup generation is 50-58 ms warm and 72-83 ms cold, of which the
  noise is about 40. Final in view on merged main, ms: Green 426, Red 613, Crystal
  559, Archipelago 315, Zhon 514, Ice 415, against 615, 547, 308, 652 and 405 for
  the last five at H14d. The agent's alternating runs of nine worlds agree within
  noise. The generated array gains two layers on most worlds, about 2.8 MB by
  formula, and two images leave.
- **Coordinator's review:** `readPalette` (a check against an image that is gone)
  and `timeStartup` (no caller) left the engine.
- **Coordinator's merge checks:** 27 scenes on main 0.00 against the fresh clone,
  27 consoles clean; `regional.mjs` 0 mismatches on `<world>-1` of all nine
  worlds; `smoke.mjs` exit 0 (`ok`) on nine worlds plus 8×8 Green, Lava, Ice,
  Zhon, Red and Archipelago; 22 of 22 tests; `repro/gate.sh` exit 0.

**Still open:** the ripple on Ice and Red is more regular than the art's. Red's and
Crystal's dithered shallows and Zhon's river water keep the band fit, with no ripple. The noise costs about 40 ms on the CPU. Many keys in
each table's `world.defaults` were carried verbatim and not audited.

### H15. Shape: one cross-section for every kind

Decision 16: every kind draws through one parametric cross-section, each
kind's classic curve (`profile` 0) becomes a preset of it, and the
classic-or-parametric choice goes. Modifiers stay on top: outline (lobes,
distortion), crest (jag, vary, taper, spurs), base (bumps, apron) and surface
marks.

**The conflict to settle first.** The audit
(`docs/audit/TOOL_AUDIT.md`, "Shared cross-section replacement") fitted today's
`crossSection` to the classic plateau and rounded ridge and rejected it: best
raised-region RMS 6.40 and 17.52 height units, maximum 13.59 and 32.06. It was a
bounded search of today's form (30 and 90 combinations), not proof that no form
fits. So this card widens the form first, and **the owner sees the comparison
before any classic curve goes.**

**Part 1, deliver,** one commit each:
1. **Inventory.** Every kind's classic curve in `engine-shape.wgsl`: what it
   computes, which tools, worlds and scenes reach it, and which modifiers read
   it. Which kinds are one curve under two names. Any kind whose curve is not a
   function of distance alone. A table in the Done list.
2. **A wider cross-section.** The fewest new numbers that reach the classic
   curves. Say what each one does in an artist's words. Every classic path
   stays, and 27 scenes stay 0.00.
3. **Fit every curve** with a tool in `measure/`: one set of numbers per kind,
   checked over the sizes and amounts the scenes use. Report RMS and maximum
   height error per kind, on the audit's raised-region measure so the numbers
   compare with 6.40 and 17.52.
4. **The comparison.** Per kind, a plot of classic against preset. Then all 27
   scenes with every classic curve replaced by its preset, beside retail at 1×
   and 2×, with `compare.py` and `stats.py` against `merge-h14e`. Retail is the
   bar (decision 22): say for each kind whether the preset is closer to retail
   than classic or further from it. The height errors are evidence, not a pass
   mark. The switch that does this is for the comparison only and does not land.
5. **`moonLobes` into `baseVary` and `baseBump`,** if the look allows (decision
   17), judged on Moon's three windows. If not, it stays, with its sheet.

**Stop there and report.** Nothing is deleted in part 1. The coordinator takes
the comparison to the owner, and part 2 follows their ruling.

**Part 2, after the ruling:** each kind's curve is numbers in one preset table,
`profile` 0 and the classic paths go, the classic-or-parametric choice leaves the
UI, and `sculpt-control-schema.js` follows. Any kind the owner keeps as it is
stays with its reason. An old save that uses a dropped option draws without it
(decision 18).

**Acceptance:** as H14, each world's three retail windows by eye at 1× and 2×.
Part 2 reports `engine-shape.wgsl` lines and shape knobs before and after, and
must lower both. `regional.mjs` 0 and `smoke.mjs` clean on nine worlds and 8×8.
Shape stays on the GPU path with no drag slower than `merge-h14e`.

**Server and guard:** port 8885, CDP 9685; worktree `../terraform-wt-H15`,
branch `H15-shape`; assets `$R/agent-H15`.

## After the cards

The owner reviews each branch: reads the diff, checks the gating, re-runs
`compare.py`, and looks at the review sheets. The branches are then merged
one at a time. Next come a blind round (`repro/blind/build_round.py`, with
reviewers judging by eye) and the report. Later, worker-based multi-core
shape replay extracts the shape engine from `sculpt.js`. It waits until
the visual cards have landed, because every card edits that file.
