# Retail round: one world per card, closer to retail

**Parked on 2026-11-09 (AGENTS.md rule 10).** The owner put realistic
terrain first and will return to retail later. Start no retail round until
then. This page, the scenes and `repro/retail.sh` are kept for that return.

A round of cards, one per world, each run by a small agent that tries
settings against the world's retail windows, keeps what brings all of them
closer, and proposes the tool or control changes it could not make with
settings alone. The cards share this page; each brief adds only its world's
row of the table at the end.

Retail is the gold standard (AGENTS.md rule 10): a world is judged across all
of its windows against retail, never against its last render. Fix the shape
before the color.

## What a card has

- **Its windows.** `repro/scenes/<world>-1..3.json`, each a stroke list
  that rebuilds a 1024-px window of a retail map (Zhon: a map editor
  section). The retail crop, its heights and a height relief are in
  `$R/repro-r7/<world>-N/` (`retail.png`, `heights.npy`, `relief.png`).
  `R=/private/tmp/nanolathe-map-editor`.
- **The world's retail maps.** `$R/retail-<world>/`, one export per map
  (`repro/retail_crop.py map` cuts more windows). They are also the family
  `repro/stats.py` measures the world's range on.
- **The map editor's sections.** TA's map editor builds maps from
  sections, and the section packs show the world's building blocks: cliffs,
  shores, hills, craters, pools. Contact sheets by kind are in
  `$R/catalogs/sections-<pack>/sheets/` (TA's own Lava and Moon sections
  are folders of art and heights under
  `$R/catalogs/sections/worlds/sections/<world>/`). Use them to see what the
  world's pieces look like at 1x and which landforms its presets must make.
  `python repro/retail_sources.py --worlds <world>` lists what is on this
  machine.
- **Numbers.** `repro/retail.sh <world>` renders the world's windows under
  Node (no server, no browser; about 20 s) and prints, per window:
  - a **shape** score, the mean gap of the height metrics: slopes,
    roughness, water share, shore band;
  - a **look** score, the mean gap of the picture metrics: luma mean and
    spread, color histogram, edges, band-pass energy, thin dark lines;
  - how many metrics fall inside the world's retail band;
  - the five metrics furthest from retail.

  A gap is |ours - retail| on the same window, in units of the width of the
  world's own retail family band (p10-p90 over 24 windows of its maps).
  Lower is closer, and 0 is retail. `<out>/stats/stats.md` has every
  number, and `<out>/scenes/<window>/pair.png` shows retail beside ours at
  full size (`layout.png`: the two height reliefs).
- **Settings to try.** `node repro/retail_knobs.mjs <world> [--changed]
  [--group Relief]` lists the World rows by key with their range and the
  world's value. `repro/retail.sh <world> --query 'key=v&key=v' --base
  <the first run's out>` renders with them and prints each window's change
  in both scores, with `<out>/triptych/<world>.png` (retail | before |
  after).

## The loop

1. **Set up.** Make a worktree: `git worktree add
   ../terraform-wt-retail-<world> -b retail-<world> main`. Run
   `repro/retail.sh <world>`, and keep its folder as the base. Open each
   window's `pair.png` and `layout.png`, and write down, per window, what
   differs most, the shape first.
2. **Shape.** If `layout.png` shows the strokes do not follow the retail
   heights, the window is a bad fixture: fix the scene's strokes to match
   `relief.png` (that is the only reason to edit a scene) and say so. If
   the strokes follow and the shape score is still high, the presets or
   the engine are wrong. Try the landform presets of the world's buttons
   (`sculpt-scene.js` `TOOL_PRESETS[world]`, numbers only) and the shape
   rows of the World panel.
3. **Look.** Try World rows with `--query`, a few at a time, guided by the
   furthest metrics. The look's levers are:
   - light: `ambient`, `lightCap`, `shadeDepth`, and `creaseShade` (gully
     and valley floors shaded whatever their facing: Gullies on a round hill
     cut radial spokes, which a world that keeps little directional shading
     shows only with it);
   - ground detail: the `relief*` rows and `plainRelief`;
   - low ground and water: `lowTint`, `lowReach` and `lowGrain` (a mud color
     and smoother grain from the sea up to the reach, and in the water; the
     color itself is `?lowColor=rrggbb` in a `--query`);
   - faces: `microRock`, `slopeTexture`, the `rock*` rows and `cliff*`;
   - cracks and bands;
   - water;
   - stroke options (Steps, Gullies, Spurs, a section's curve): a `--query`
     cannot set these either, and says so. A scene's strokes take theirs
     from their cards, which pin most of them, and the rest from the world's
     defaults (`sculpt.py` `WORLD_KNOBS`, which a stroke's card overrides);
     a scene stroke's tool must be one the editor draws (a section form such
     as Mesa goes in the card's curve). To try one, render copies of the
     scenes with it on their cards (`REPRO_SCENES` for `repro/all.sh`, then
     `stats.py` and `retail_gap.py` as `retail.sh` runs them). A round or
     oval landform with a broad flat top (bergs, mesas, isles) is a Plateau
     on a click or a short path, its shoulder softened in the section's
     curve; ragged shoreline steps are Layer edge jag (`layerJag`);
   - the world's colors: a `--query` cannot set these. Change them in
     `sculpt.py` `WORLD_KNOBS`/`WORLD_VARIANTS` colors and rerun.

   Keep a change only when it brings every window closer, or holds two and
   clearly helps the third, both by the numbers and by eye on the sheets.
   A score can be gamed: a flat gray that matches the luma mean is not
   retail.
4. **Keep it.** Write the values where the world's preset lives:
   - `sculpt.py` `WORLD_KNOBS[world]` (or a variant in `WORLD_VARIANTS`);
   - `sculpt-scene.js` `TOOL_PRESETS[world]` for brush presets;
   - `materials/<world>.json` for measured tables.

   One commit per idea, with every window's shape and look scores before
   and after in the message.
5. **Check.** `repro/check.sh quick --worlds <world>`: only the world's
   own scenes may move. A variant's scenes go by their own name, so Green's
   card passes `--worlds green,green-modern` only if it changed both.
   Before you hand back, run `repro/check.sh land --server <yours>
   --port <cdp>` too (your own server: BACKLOG ground rule 2).
6. **Propose.** When no setting closes a gap, write what retail shows,
   which metric and window show it, which existing control comes closest,
   and what change would close it: a stronger range, a new preset, a
   generic landform feature, or a tool. Do not add a control or a tool in
   a round card (AGENTS.md rules 3 and 9).

## Rules for a round card

- AGENTS.md applies in full. Most often missed here:
  - never commit anything under `$R` or derived from retail (pictures,
    heights, crops, sheets);
  - never write into `~/TotalAnnihilation`;
  - no new dependencies;
  - use American English.
- One engine (rule 7): no code that branches on a world's name. A world
  changes only through its numbers and colors, its presets and its tables.
- Every kept control must still move 5% of its class (rule 9). A setting at
  0 that removes a feature is fine; a feature a world cannot turn on is a
  proposal.
- Scale (rule 11): judge at 1x, on `pair.png`, not on a thumbnail.
- Report each claim as measured (the number) or by eye. When the numbers
  and your eye disagree, say so and do not keep the change.

## Report

1. **Scores.** A table: window, shape and look before and after, metrics
   in band before and after.
2. **Changes.** Each change: its commit, the setting, its value before
   and after, and why.
3. **By eye.** What changed, per window, with the sheet paths.
4. **Proposals.** What still differs from retail and needs a tool or
   engine change, with the window and metric that show it.
5. **Not done.** What was tried and dropped, with its numbers.

## The worlds

Starting scores on main (`repro/retail.sh <world>`, mean of the world's
windows; lower is closer). `Guard` is the `--worlds` value for
`repro/check.sh`.

| World | Guard | Windows | Retail maps | Section packs | Shape | Look |
| --- | --- | --- | --- | --- | ---: | ---: |
| green | `green` | 1: pc games' evad river delta; 2: great divide; 3: the barrier reef | 12 | none | 0.23 | 0.21 |
| green-modern | `green-modern` | 1: pc games' evad river delta; 2: great divide; 3: the barrier reef | as Green | as Green | 0.21 | 0.59 |
| red | `red` | 1: red planet; 2: red river; 3: gods of war | 8 | none | 0.25 | 0.25 |
| archipelago | `archipelago` | 1: hundred isles; 2: canal crossing; 3: east indeez | 9 | none | 0.30 | 0.51 |
| moon | `moon` | 1: cc21; 2: full moon; 3: ac20 | 12 | moon (68) | 0.34 | 0.23 |
| zhon | `zhon` | 1: low savannah rivers/cbe705ad; 2: low savannah rivers/78c00eee; 3: low savannah rivers/5119d591 | none (sections) | sections-zhon (575) | 0.27 | 0.14 |
| lava | `lava` | 1: kill the middle; 2: red hot lava; 3: lava & two hills | 10 | lava (81) | 0.43 | 0.14 |
| desert | `desert` | 1: painted desert; 2: the desert triad; 3: painted desert | 2 | none | 1.31 | 0.44 |
| crystal | `crystal` | 1: crystal cracked; 2: crystal isles; 3: brilliant cut lake | 4 | sections-crystal (87), sections-uadamante-crystal (74), sections-ulava-crystal (75) | 0.14 | 0.16 |
| ice | `ice` | 1: ice scream; 2: icy bergs; 3: polar range | 7 | sections-ice (75) | 0.18 | 0.08 |

Notes for the briefs:
- Desert's family is two maps, so its bands are narrow and its gaps large.
  Its shape gap is real, though. On desert-2 retail has 2.3% of dry cells
  nearly level (slope under .03) and ours 77%: retail's ground rolls
  everywhere and ours is a level plain. Its card starts with the shape.
- Modern Green's look gap is mostly thin dark lines (green-modern-1: .0061
  per pixel against retail's .0021) and edge density (.20 against .11):
  the realistic look's gullies and cracks read busier than retail at 1x.
  Archipelago-3 has the same metric the other way (retail .0056, ours
  .0032). Moon-1 has only 10 of 22 metrics in band.
- Green's settings are also modern Green's (a variant lays its own over
  them), so a change to `WORLD_KNOBS['green']` moves both:
  `--worlds green,green-modern`.
- Green, Red, Archipelago and Desert have no map editor section pack on
  this machine; their cards work from maps only. ta-archive.com lists
  more packs (`TASect_*.hpi`). Fetching one, as `catalogs/dl-ice` was
  fetched with its provenance, is the owner's call.
- Zhon has no retail maps. Its family and its windows are sections
  (`low savannah rivers`).
- The modern Green variant (`green-modern`) has its own card and realism
  report (AGENTS.md "Checks", modern Green).
- A section pack's heights carry no sea level, so `stats.py` measures a
  family only from maps (and Zhon's sections, with the sea of its crops).
  Section-based numbers for the other packs are a follow-up.
