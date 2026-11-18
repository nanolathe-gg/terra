# Retail atlas: where the retail pictures and data are

All paths below are under `$R` (default `/tmp/nanolathe-map-editor`, a
symlink to the owner's assets folder). None of it is in Git, and none of it
may be committed. You may read it, open its pictures, and cut new crops into
your output folder.

## The windows (what the harness scores)

- **Strokes:** `repro/scenes/<world>-<n>.json` (in the checkout). Each scene
  is a stroke list that rebuilds a 1024 px window of a retail map. Its
  `source` names the map and the window's top-left corner.
- **Retail data:** `repro-r7/<world>-<n>/`, which holds:
  - `retail.png`: the retail picture, in screen space;
  - `heights.npy`: one height per 16 px cell, above the sea;
  - `relief.png`: shaded heights with a 128 px grid;
  - `crop.json`.
- **Your trial's outputs:** `match/<worktree>/<world>/<trial>/`, which holds:
  - `scenes/<window>/pair.png`: retail beside ours;
  - `scenes/<window>/layout.png`: the two height reliefs;
  - `classes/crops/<window>/<class>.png`: retail and ours at 2x, per class;
  - `classes/classes.md`: the numbers per class;
  - `gap.txt`: the whole-window scores;
  - `candidate.diff`: your files' changes for this trial.
- **The held-out window** is the highest-numbered one. Trials skip it, and
  `--holdout` renders only it.

## Whole retail maps

- **Map exports:** `retail-<world>/<map>/`, one folder per map.
  `thumbnail.png` shows the whole map. `metadata.json` gives its size and
  sea level. The rest is binary: `map-indexed.bin`, `heights.bin`,
  `palette-rgb.bin`.
- **The list of maps:** `map-catalog.json`, every retail map with its
  world.
- **Cutting a 1x window of any map** into your output folder:

  ```sh
  $PYTHON repro/retail_crop.py map $R/retail-<world>/<map> <x> <y> <out>/crops/<name>
  ```

  `x` and `y` are multiples of 16. You get `retail.png` (1024 px),
  `heights.npy` and `relief.png`. Use this to see a feature at 1x that your
  windows do not show.
- **What is on this machine:** `$PYTHON repro/retail_sources.py --worlds
  <world>` lists it.

## Building blocks and catalogs

- **The feature catalog:** `docs/BIOME_CATALOG.md` (in the checkout). For
  each world it covers the recurring retail features, the tool and rock type
  that draw each one, a status, and the gaps that are known and ranked.
  Start here, so you do not rediscover a known gap.
- **The previous round's catalogs:**
  `agent-biome-match/out/catalog/<world>/`. `catalog.md` has measured
  feature sizes and passability. `crops/` holds retail feature crops at 1x,
  and `pairs/` holds retail beside the editor's tool for that feature. They
  are from before the material and surface-layer rework, so the editor side
  is out of date. The retail side is not.
- **TA's map editor section packs:** `catalogs/sections-<pack>/` (with
  `sheets/` contact sheets by kind: cliffs, shores, hills, craters) and
  `catalogs/sections/worlds/sections/<world>/` (Lava, Moon). These are the
  world's own building blocks at 1x.
- **The owner's realism references:** `references/`. These are other
  people's art, not retail. They are the long-term realism target, not this
  task's target.

## The worlds

Your base trial prints each window's starting scores.

| World | Windows (held out) | Retail maps | Sections | Notes |
| --- | --- | --- | --- | --- |
| green | 1-6 (7) | 37 | none | dossier: [worlds/green.md](worlds/green.md) |
| red | 1-2 (3) | 17 | none | |
| archipelago | 1-2 (3) | 14 | none | known tells: even fringe rings, rippled sand, banded shallows |
| moon | 1-2 (3) | 12 | moon | |
| zhon | 1-2 (3) | none | sections-zhon | the windows are map editor sections |
| lava | 1-2 (3) | 19 | lava | |
| desert | 1-2 (3) | 3 (+6 Wet Desert) | none | its shape gap is real: retail's ground rolls everywhere |
| crystal | 1-2 (3) | 10 | sections-crystal and two more | |
| ice | 1-2 (3) | 22 | sections-ice | |

## Writing a world's dossier

If `worlds/<world>.md` is missing, write it before your first trial,
following `worlds/green.md`. Draw on:

- the world's section of `docs/BIOME_CATALOG.md`;
- its `catalog.md`;
- your own look at its windows' `retail.png` and a few map thumbnails.

Keep it short: what the world's retail looks like at 1x, class by class,
and what is known not to work.
