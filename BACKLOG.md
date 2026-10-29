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

2. **Your own server, browser port and assets** (table below). Copy the
   prepared assets once, then serve every world (a missing world silently
   renders as Green, so never pass `--biomes`):

   ```
   R=/private/tmp/nanolathe-map-editor
   mkdir -p $R/agent-<card> && cp -R $R/assets-* $R/features $R/map-catalog.json $R/agent-<card>/
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
Keep the other worlds in mind, and gate everything to Green (rule 4).

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

H5 (weather on the GPU everywhere), H6 (shape on the GPU) and H7
(progressive rendering), which complete the Green slice, are outlined in
[docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md#cards), with the rules every
card from H3 on follows. Each is written here in full when the card before
it lands.

## After the cards

The owner reviews each branch: reads the diff, checks the gating, re-runs
`compare.py`, and looks at the review sheets. The branches are then merged
one at a time. Next come a blind round (`repro/blind/build_round.py`, with
reviewers judging by eye) and the report. Later, worker-based multi-core
shape replay extracts the shape engine from `sculpt.js`. It waits until
the visual cards have landed, because every card edits that file.
