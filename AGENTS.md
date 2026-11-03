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
   rule 2). Never stop a process you did not start.
3. **Do the task you were given, at the size you were given.** Add no
   panels, pages, buttons, tools or controls the task does not ask for. If
   you think the editor needs one, propose it in your report.
4. **Land on main only when the work is reviewed and its checks pass.**
   Merge `main` into your branch first and run the checks again. If you were
   not asked to land, commit on your branch, report and stop.
5. **One commit per idea.** The message says what changed, why, and the
   measured effect. In your report, mark each claim as measured (with the
   number) or by eye, and say what is unfinished.
6. **Never commit retail-derived files**: pictures, heights, crops, renders
   or maps. Never write into `~/TotalAnnihilation`. No `rm -rf`, and no new
   dependencies.

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
   - An old save that uses a removed option loads without it.
8. **One editor.** `/sculpt` is the editor. A new tool joins its tool list,
   stroke list, undo, save file, scenes and export.
   - Add no separate pages, save formats, storage keys or undo stacks.
   - A prototype that breaks this stays on a `prototype/*` branch and does
     not land; port its ideas instead.
9. **Few controls, and each one earns its place.**
   - Reuse or extend an existing control before adding one. A new control
     replaces or simplifies something; it does not sit beside it.
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
10. **Retail is the gold standard.** A world's look and its quality targets
    come from retail crops: three windows per world, from different maps
    (`repro/scenes/<world>-1..3.json`, crops in `$R/repro-r7`).
    - Judge a visual change against retail, across all of a world's
      windows, not against the last render. It may move the output when it
      keeps or improves the match.
    - Fix the shape before the colour.
    - Tables measured from retail art may be committed. Retail pixels and
      maps are never read at run time.
11. **TA's scale.** One art pixel is the unit, and detail must read at 1x:
    grit, stones, gouges and scratches. The game keeps one height byte per
    16-pixel cell, so anything finer exists only in the art. Anything meant
    to change how units move must show in those heights.
12. **Deterministic.** The same scene renders and exports the same bytes on
    the same machine, and `repro/regional.mjs` finds no mismatch.

## Checks

Run the checks your change touches while you work, and all of them before
landing.

| Check | Command | Passes when |
| --- | --- | --- |
| Scenes | `repro/all.sh`, then `repro/compare.py` (BACKLOG ground rule 3) | untouched scenes match byte for byte; changed ones are judged on the retail sheets |
| Regional replay | `node repro/regional.mjs` | no mismatch |
| Brushes, undo, export | `node repro/smoke.mjs`, and `--page8` for large maps | exit 0 |
| Unit tests | `go test ./...` | all pass |
| World names | `sh repro/gate.sh` | exit 0, and the list is no longer |
| Controls | `node measure/world_controls.mjs` and `measure/shape_controls.mjs` | for any control added, moved or removed |
| Interaction | `node repro/perf.mjs`, alternating runs of the two builds | for anything on the drag or bake path |

Use American English in all user-visible text.
