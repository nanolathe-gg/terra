# Terraform: rules for agents

Terraform is an experimental browser (WebGPU) terrain and map editor for
Total Annihilation. These rules apply to every agent working in this
repository. The owner's decisions behind them are in
[docs/TERRAIN_ENGINE.md](docs/TERRAIN_ENGINE.md) ("Decisions" and "Rules for
the cards"). Setup and ports are in
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
   If `main` has moved, merge it into your branch first and rerun checks
   affected by the combined changes. Do not repeat unchanged checks. If you
   were not asked to land, commit on your branch, report and stop. Main is
   what the live site serves: once the repository is public, every push to
   `main` deploys to terra.nanolathe.gg (`.github/workflows/pages.yml`).
5. **One commit per idea.** The message says what changed, why, and the
   measured effect. In your report, mark each claim as measured (with the
   number) or by eye, and say what is unfinished.
6. **Never commit retail-derived files**: pictures, heights, crops, renders
   or maps. Never write into `~/TotalAnnihilation`. No `rm -rf`, and no new
   dependencies. Our own renders of authored fixtures are not retail-derived:
   preview PNGs are published as a release bundle, not committed.
   `preview-assets.json` pins the bundle and rendering-input fingerprint;
   `repro/ui-previews.mjs` regenerates the full set when those inputs change.
   One test-only tool is owner-approved: Dawn's Node binding (npm
   `webgpu`), installed outside the repository (`$TERRAFORM_WEBGPU`, see
   `repro/headless.mjs`) for the headless checks; the editor and the site
   never load it. The game's 256-color palette (`materials/palette.json`)
   is engine data, not retail art, and is committed.
   - The repository is MIT-licensed and will be public. Never commit
     secrets or tokens; the save-link Worker's admin token stays outside it.

## What the editor is

7. **One engine.** Every world runs the same GPU pipeline: shape, ground,
   time, surface and light. A world is data: its numbers in
   `materials/<world>.json`, its presets, and its ground and water
   materials (`materials/textures.json`).
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
8. **One editor.** `/` is the editor. A new tool joins its tool list,
   stroke list, undo, save file, scenes and export.
   - Add no separate pages, save formats, storage keys or undo stacks.
   - A prototype that breaks this stays on a `prototype/*` branch and does
     not land; port its ideas instead.
   - The editor is a static site (`go run ./cmd/terraform --build-site <dir>`;
     GitHub Pages).
     Everything the page needs is a file in the build: no server-only path
     or endpoint. Export runs in the page (the exporter built to
     WebAssembly), and share links go to the save-link Worker
     (`deploy/worker/`). The Go command serves the same files for development
     (`repro/site.build.test.mjs` checks the build on demand).
   - Layout lives in `index.html`: each element sits at its final place,
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
   - Every kept control must visibly matter at 1x across the range an
     artist would use. Judge its usefulness by eye. The impact reports
     (`measure/impact.py`, `measure/shape_controls.mjs`,
     `measure/world_controls.mjs`) are optional diagnostic tools; the old
     5% threshold is evidence, not a pass/fail requirement.
   - A control must be artistically useful: something an artist would set
     on purpose for a different look. Implementation constants stay in code.
   - Presets are only numbers for existing controls, except a material's
     (next point).
   - Ground and water textures are materials, and the material editor is
     the only way to set them (owner's decisions of 2026-11-14). A material
     is a node graph (`sculpt-materials.js`) with two tiers. Its graph is
     its source: a node's settings and type choices are its author's tools,
     not world controls, and the points above do not govern them. The
     controls a material publishes are what a map maker adjusts, and the
     points above do govern those. A material preset is a graph with its
     numbers. Keep the node set small: a new node type must do what no
     combination of the existing ones can.
   - The editor shows only the material itself (its repeat, on terrain, a
     node alone). It holds no reference pictures and no comparison tools;
     matching a look against a picture is work done outside it.
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
    the same machine, and `repro/regional.mjs` finds no mismatch: exact
    on macOS (Metal); on other GPUs a value within 2 float32 steps at the
    map's top height counts as a near match (owner's decision of
    2026-11-14, for NVIDIA's Vulkan rounding). Two machines may export
    slightly different files: a map is exported once and every match uses
    that file (owner, 2026-11-14). A material's palette reduction spreads
    such rounding differences, so its dither dots may differ between GPUs.

## Preview assets and pushing

Preview PNGs and `ui-previews/rendered.json` stay outside Git. Keep the small
`ui-previews/manifest.json`, `preview-inputs.json` and `preview-assets.json`
committed. The Go server/build fetches the checksum-pinned release bundle when
local files are missing; CI needs no GPU. Private releases require `gh auth
login` or `GH_TOKEN`/`GITHUB_TOKEN`. Render only on your own server/CDP ports.

After cloning, run `go run ./cmd/previews install-hook`. The pre-push hook
checks the actual outgoing commits, publication, the receipt inside the bundle,
and the absence of preview PNG/browser output in their history. Never bypass
it to push stale assets. CI repeats the freshness/publication check. When it
fails, render the full set and run `go run ./cmd/previews publish`; do not edit
the fingerprint by hand. Publish keeps the pinned bundle and only records the
new inputs when no frame changed visibly; `--force` uploads anyway. Changes during rendering invalidate the receipt.
See [the asset workflow](docs/PREVIEW_ASSETS.md).

## Checks

Optimize for fast iteration on this unreleased editor. Run checks that can
catch a failure caused by your change. Do not run every integration check,
every scene, control sweeps, realism reports or performance benchmarks for
every change. Older cards asking for broad checks do not override this rule.

- During iteration, run relevant unit tests (`node --test repro/paths.test.mjs`,
  for example) and inspect changed editor behavior. Documentation-only edits
  need no runtime checks.
- Before handing back or merging code, run `repro/check.sh quick` once, or
  the relevant unit tests for a narrowly scoped change. Run a small browser
  smoke if editor behavior changed, plus the integration checks below that
  directly protect the changed behavior. Test-runner and documentation changes
  do not require a browser.
- Repeat a passing check only after a relevant edit, failure, or new concern.
  Report what was checked and what was deliberately left on demand. Do not
  claim a check passed if it skipped the behavior being tested.

`repro/check.sh` defaults to `quick`. It prints each check's time and log;
`--list` shows the exact commands without running them. The old `land` and
`full` tiers are retired. There is no automatic baseline render or retail
asset dependency in this runner.

| Group | Command | Use when |
| --- | --- | --- |
| quick | `repro/check.sh` | Fast Node unit tests and the world-name gate; no Python, Go, GPU, browser or site build. `--test repro/paths.test.mjs` selects one test file (repeatable). |
| browser | `repro/check.sh browser --server <yours> --port <cdp> [--worlds green]` | Changed editor behavior: brush/undo smoke on one world by default, without export or the large-map sweep. Use the affected world. |
| engine | `repro/check.sh engine [--scene repro/shape-scenes/<fixture>.json]` | Changed GPU fields, tiling or replay: GPU height tests, regional replay and repeat determinism. Defaults to three authored fixtures; `--scene` replaces them (repeatable). Needs Dawn and Go for configs. |
| export | `repro/check.sh export` | Changed exporter, worker or archive format: Go exporter tests and native/WebAssembly byte parity. Needs Go. |
| features | `repro/check.sh features` | Changed procedural sprite generation or burning: CPU feature-art checks, without Python or GPU. |
| config | `repro/check.sh config` | Changed generated configs, world/tool data or preset assembly. Go config/server tests and generated config integration tests. Needs Go. |
| assets | `repro/check.sh assets` | Preview freshness/publication, fetching and PNG/manifest validation. CPU only; requires Go, Node and release access. |
| site | `repro/check.sh site` | Changed static packaging or shipped file paths: build and inspect the static site. Needs Go. Deployment checks the built artifact once. |

The development server reloads source bytes, the source manifest and JSON
config inputs on requests; refresh the browser to see edits. Go exporter
sources rebuild on demand. Only changes to the server's Go code require a
process restart. Defaults are data in `materials/defaults.json` and each
world's `world.knobDefaults`, `world.engineDefaults` and `world.rock` (its own rock types);
`site.json` declares the shipped source files and world/recipe ordering.

Build, config, export, feature-art and GPU integration tests use explicit
filename suffixes: `.build.test.mjs`, `.config.test.mjs`, `.export.test.mjs`,
`.features.test.mjs`, `.assets.test.mjs` and `.gpu.test.mjs`. Keep expensive work out of ordinary
`.test.mjs` files.
Use the runner instead of `node --test repro/*.test.mjs`, which includes
all integration tests. No new test should freeze an artistic preset or page
layout merely to preserve today's implementation.

Use additional standalone checks only for the work they protect:

- Export art/height changes: `node repro/export-bytes.mjs`. Scope fixtures
  where the tool supports it; a renderer change need not trigger every export.
- Section editor, features, passability or workspace: the corresponding
  `repro/curveedit.mjs`, `features.mjs`, `passability.mjs` or `workspace.mjs`,
  with your own `--server` and `--port`.
- Drag or bake performance: `node repro/perf.mjs` when investigating or
  claiming a performance change; compare both builds under similar conditions.
- Visual terrain work: inspect affected authored scenes at 1x. Realism reports,
  control sweeps and before/after image comparisons are research aids, run when
  they answer a concrete question or the owner requests them. Numeric realism
  gates and the old 5% impact threshold do not decide artistic acceptance.

The browser checks must use your own server and explicit CDP port; some
standalone tools use `<cdp>` through `<cdp>+2`. Never use the owner's 8801.
Engine fixtures run under Node on Dawn without a server or browser. Old
scene images are not an artistic compatibility contract: keep same-build
determinism, regional equivalence and valid exported maps, and judge intended
visual changes by eye (rule 10).

`repro/all.sh`, `repro/compare.py`, retail scenes and sheets remain available
for explicit investigations. `repro/retail.sh` (docs/RETAIL_ROUND.md) stays
parked with rule 10. Do not gate work on retail scores or generate retail
comparison sheets as part of routine validation.

Use American English in all user-visible text.
