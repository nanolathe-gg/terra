# Terraform: rules for agents

Terraform is an experimental browser (WebGPU) terrain and map editor for
Total Annihilation. These rules apply to every agent working in this
repository. The owner's decisions behind them are in
[docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md) ("Decisions" and "Rules for
the cards"). Setup, ports and the render guard are in
[BACKLOG.md's ground rules](BACKLOG.md#ground-rules-every-card). Where this
page and an older card disagree, this page wins.

## How to work

1. **Work in a worktree:** `git worktree add ../terraform-wt-<task> -b <task> main`.
   Never edit the main checkout or another agent's worktree. Never reset,
   rebase, stash, amend or force-push `main` or anyone else's work.
2. **Use your own server, browser port and assets root** (BACKLOG ground
   rule 2). Never stop a process you did not start. Port 8801 is the
   owner's editor, and the Chrome checks default to it (CDP 9450): always
   pass `--server` and `--port`.
3. **Do the task you were given, at the size you were given.** Add no
   panels, pages, buttons, tools or controls the task does not ask for. If
   you think the editor needs one, propose it in your report.
4. **Land on main only when the work is reviewed and its checks pass.**
   Merge `main` into your branch first and run the checks again. If you were
   not asked to land, commit on your branch, report and stop. Main is what
   the live site serves: once the repository is public, every push to
   `main` deploys to terra.nanolathe.gg (`.github/workflows/pages.yml`).
5. **One commit per idea.** The message says what changed, why, and the
   measured effect. In your report, mark each claim as measured (with the
   number) or by eye, and say what is unfinished.
6. **Never commit retail-derived files**: pictures, heights, crops, renders
   or maps. Never write into `~/TotalAnnihilation`. No `rm -rf`, and no new
   dependencies. Our own renders of authored fixtures are not retail-derived:
   the hover examples in `ui-previews/` are committed, and
   `repro/ui-previews.mjs` regenerates them when a preset or the renderer
   changes. One test-only tool is owner-approved: Dawn's Node binding (npm
   `webgpu`), installed outside the repository (`$TERRAFORM_WEBGPU`, see
   `repro/headless.mjs`) for the headless checks; the editor and the site
   never load it. The game's 256-color palette (`materials/palette.json`)
   is engine data, not retail art, and is committed.
   - The repository is MIT-licensed and will be public. Never commit
     secrets or tokens; the save-link Worker's admin token stays outside it.

## What the editor is

7. **One engine.** Every world runs the same GPU pipeline: shape, ground,
   time, surface and light. A world is data: its numbers in
   `materials/<world>.json` and its presets.
   - Code branches on a feature or on material data, never on a world's
     name (`repro/gate.sh` checks this).
   - There is one render path. Don't keep a CPU copy of GPU work, add a
     shader switch for one tool or page, or add a flag that keeps an old
     path alive.
   - A change becomes main's behaviour everywhere it applies, or it does not
     land.
   - An old save that uses a removed option loads without it. Until
     release, saves and share links are no compatibility promise; only an
     exported `.ufo` is. Remove an option outright: no migrations, no
     hidden values that still render.
8. **One editor.** `/sculpt` is the editor. A new tool joins its tool list,
   stroke list, undo, save file, scenes and export.
   - Add no separate pages, save formats, storage keys or undo stacks.
   - A prototype that breaks this stays on a `prototype/*` branch and does
     not land; port its ideas instead.
   - The editor is a static site (`sculpt.py --build-site`; GitHub Pages).
     Everything the page needs is a file in the build: no server-only path
     or endpoint. Export runs in the page (the exporter built to
     WebAssembly), and share links go to the save-link Worker
     (`deploy/worker/`). `sculpt.py` serves the same files for development
     (`repro/site.test.mjs` checks the build).
   - Layout lives in `sculpt.html`: each element sits at its final place,
     and no script moves, reorders or renames page elements at load. The one
     exception is the toolbar's shape buttons, which are built from the
     world's tool list and the map's own tools.
9. **A control for everything an artist would shape, and each one earns its place.**
   - Artists set a world's look by hand (shape, structure, layering,
     variation, roughness, broad and fine detail, weathering, color,
     vegetation, wetness, shine), and their settings become the world's
     defaults. Reuse or extend an existing control before adding one; a new
     control does not duplicate one that sits beside it.
   - Every control is continuous: its low end is a value of the same model,
     not a switch. Moving it to 0, or a small step above 0, changes the
     picture a little, never into a different render path.
   - Every kept control must visibly matter at 1x. Across the range an
     artist would use, it moves at least 5% of its class
     (`measure/impact.py`, `measure/shape_controls.mjs`,
     `measure/world_controls.mjs`). Below that, make it stronger or remove
     it.
   - A control must be artistically useful: something an artist would set
     on purpose for a different look. Implementation constants stay in code.
   - Presets are only numbers for existing controls.
   - A control the panel disables says why (`worldControlRequirement`,
     `shapeControlAvailable`).
10. **Real terrain is the standard for now; retail comes back later.** The
    owner's decision of 2026-11-09: "let's focus significant work on
    realistic high quality terrain generation and not focus on matching
    retail, then we'll circle back later once we have more realism and
    proper controls for each feature that created it."
    - Judge a visual change by eye against real terrain and the owner's
      reference pictures, not against the last render. The owner has the
      final say on a look. The reference pictures are other people's art
      and stay outside the repository.
    - Do not tune a world toward retail crops, and do not turn a change
      down because it moves a retail score.
    - Nothing retail is deleted. The retail windows
      (`repro/scenes/<world>-1..3.json`, crops in `$R/repro-r7`),
      `repro/retail.sh` and the comparison sheets are kept for the return.
    - Fix the shape before the colour.
    - Tables measured from retail art may be committed. Retail pixels,
      sprites and maps are never read at run time.
    - Generated art (ground, features) stays procedural: no embedded or
      traced retail pixels, masks or shapes.
11. **TA's scale.** One art pixel is the unit, and detail must read at 1x:
    grit, stones, gouges and scratches. The game keeps one height byte per
    16-pixel cell, so anything finer exists only in the art. Anything meant
    to change how units move must show in those heights. A map holds at
    most 65,536 distinct 32-pixel tiles; beyond that, export merges the
    most alike tiles and the Export pane warns.
12. **Deterministic.** The same scene renders and exports the same bytes on
    the same machine, and `repro/regional.mjs` finds no mismatch.

## Checks

`repro/check.sh` runs the checks in three tiers and prints one line per
check with its time and log. Run `quick` while you work and `land` before
landing, with the checks below that your change touches; `full` runs them
all, for a release.

| Tier | Command | Runs | Time |
| --- | --- | --- | --- |
| quick | `repro/check.sh quick [--worlds green,lava]` | unit tests, world names, regional replay, every scene against the base | 30 s (70 s once after main moves) |
| land | `repro/check.sh land --server <yours> --port <cdp> [--worlds ...]` | quick, then smoke with `--page8`, features, the passability view and the shape repeat check | 2.5 min |
| full | `repro/check.sh full --server <yours> --port <cdp> [--worlds ...]` | land, then the curve editor, the workspace and ground-cover checks, export bytes, the three control sweeps and the realism report | 19 min |

A tier passes when every check in it exits 0. Scenes: untouched scenes
match the base byte for byte, and changed ones are judged by eye on the
sheet the check writes (rule 10). The base is the commit your branch grew from (`git merge-base HEAD
main`); its renders are made once and kept in `$R/baseline/<commit>`.
`--worlds` names the worlds your change may move (`none`: no scene may
move; a variant's scenes go by their own name, such as `green-modern`). The
world-name list may not grow. The Chrome checks use your server
and CDP ports `<cdp>` to `<cdp>+2`. The engine checks run under Node on
Dawn, with no server and no browser; `--chrome --server <yours>` runs one in
the page, with the same pixels.

| When your change touches | Also run | Passes when |
| --- | --- | --- |
| a control (added, moved or removed) | `node measure/world_controls.mjs --worlds <yours>`, `measure/shape_controls.mjs`, `measure/geology_controls.mjs --only <worlds>` | the control moves at least 5% of its class (rule 9) |
| the exporter or the art it is sent | `node repro/export-bytes.mjs` | exit 0 |
| the section editor | `node repro/curveedit.mjs --server <yours> --port <cdp>` | exit 0 |
| modern Green | `python measure/realism.py --scenes <out>/scenes/green-modern-1 <out>/scenes/green-modern-2 <out>/scenes/green-modern-3` | the report gives, before and after, the mean count of statistics in the real range (of 15) and how many windows pass each of the six gates (closed basins, fabric, hilltop roundness, Hack's exponent, hollow and valley shares), and says which moved and why; a slope p90 above 1.62 is the owner's call |
| the drag or bake path | `node repro/perf.mjs` (Chrome), alternating runs of the two builds | your report gives both builds' numbers |

`repro/retail.sh` (docs/RETAIL_ROUND.md) is parked with rule 10. Keep the
script; do not gate a change on its scores until the owner returns to
retail.

Use American English in all user-visible text.
