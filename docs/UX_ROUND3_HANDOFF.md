# UX round 3: handoff

Written 2026-11-16 22:05 PST by the session that orchestrated this round, for the agent that finishes it and lands it on local `main`.
Delete this file in the last commit before landing: it is a working note, not documentation.

## 1. What this is

The owner asked for a UI/UX pass on Terra ("approachable, simple-ish, usable"; a newcomer picks a world and makes a map; a tweaker
changes a world; an advanced user makes worlds, surface layers and material graphs with feedback and previews). The result was a
proposal of eight changes in six steps, then three instructions:

1. "You act as orchestrator & reviewer. Have opus implement the plan."
2. "Use your defaults" (for the open decisions, section 6).
3. "Write out a detailed handoff plan for another agent to finish this work and land it on main."

So you are asked to land. Landing means a merge into **local** `main` in `/Users/daniel/src/terraform`. **Do not push**: a push
deploys, the pre-push hook will refuse (previews are stale; publishing them is the owner's), and no one asked for it.

- Proposal (the plan, with pictures): https://claude.ai/artifact/96cfWoncPr2S1yjCFQDhX5 . Source text:
  `/private/tmp/nanolathe-map-editor/agent-ux3/page/src.html`.
- Memory with the history: `~/.claude/projects/-Users-daniel-src-terraform/memory/ux-workflows-review.md`.
- Way of working: you orchestrate and review; implementers are subagents on Opus (`Agent` tool, `model: "opus"`), one per slice,
  each with its own worktree, server port, CDP ports and assets root. Read each diff and the screenshots, send fixes back to the
  same agent, merge yourself. Two implementers at once is fine when their files do not overlap; never two in one worktree.
- CLAUDE.md applies in full. The points that have mattered: layout lives in `index.html`; no branching on a world's name; one
  render path; no control the task did not ask for; one commit per idea; claims marked measured or by eye; light checks only.

## 2. Where everything is

| Thing | Value |
| --- | --- |
| Integration branch | `ux-round3`, worktree `/Users/daniel/src/terraform-wt-ux-round3` |
| Materials branch | `ux-round3-materials`, worktree `/Users/daniel/src/terraform-wt-ux-find` (cut from `ux-round3` at 63159aae) |
| Finished side branches | `ux-round3-find` (merged), `ux-round3-start` (merged into both; its last two commits reach `ux-round3` only through the materials branch) |
| Ports, `ux-round3` | server 8993, CDP 9493-9495, assets root `/private/tmp/nanolathe-map-editor/agent-ux3` |
| Ports, materials | server 8994, CDP 9496-9498, assets root `/private/tmp/nanolathe-map-editor/agent-ux3-find` |
| Never | port 8801 (the owner's editor), a process you did not start, `~/TotalAnnihilation`, `rm -rf`, a push |
| Review screenshots | `agent-ux3/review-1a`, `review-2a`, `review-2b`; `agent-ux3-find/review-1b`, `review-5`, `review-6` (under `/private/tmp/nanolathe-map-editor/`, which is `~/terraform-assets`) |

Both worktrees are handed to you with this note: you may work in them. Every other worktree belongs to someone else.

Server: `go run ./cmd/terraform --port <port> --assets-root <root>` from the worktree. Chrome:
`--headless=new --enable-gpu --use-angle=metal --remote-debugging-port=<cdp> --user-data-dir=<under your assets root>`.
Scene URL for scripted checks: `/?biome=green&mapX=4&mapY=4&gpuMB=512&heapMB=1536&scratch` (the `scratch` parameter keeps the
map out of the saved slot; it is dropped on reload). Page hooks: `sculptCanvas.idle()`, `.view()`, `sculptDebug.scene(...)`,
`sculptDebug.sketch()`, `sculptRegion.select(i)`.

## 3. State when this was written

`main` was at 4cef1a1c. `ux-round3` contains main up to efda1e06; **main has two newer commits** (9987ce58 renderer releases,
4cef1a1c fields: an edit's cells on a page) that are not merged yet.

### Done, reviewed and on `ux-round3` (tip 12170ed6)

| Step | What | Key commits |
| --- | --- | --- |
| 1 | Shape card names its rock type and ground with Edit links; scope tag (This shape / This map / Every map in world); wording; Find box (`sculpt-find.js`, ⌘K) | 0d130cd8, 4e27ffd9, 6706a0da, merge b83362a6, fixes cf31a668 … a64659ff |
| 2a | Pick tool: rail button, key I, Alt-click from any tool; card at the pixel with the true rock type (probe indexes 20 and 89), swatches that recolor in place, doors to each setting (`sculpt-pick.js`) | a1406b33, 52bec3e4, 1b17b3e8, e900f48a |
| 5 | Top bar 20 → 9 controls (Map menu holds New/Open/Save/Share link; World tab carries the world's name; View menu); Start a map dialog (line per world, named sizes, own worlds, "+ New world from …", opens at ~200 ms); Land flyout by family (`world.tools[].family`) | 24bcd3cb, 2ca6f7f1, 2ae8aa83, f9849add, 48a67581, cc86387b, c14af79d, merge aec4d8e2 |
| — | Merge of main (through efda1e06) | 63159aae |
| 2b | World › Surface list: three sections by what draws (`SURFACE_NEEDS` in `sculpt-material-model.js`), reasons with links, closed rows in words with Coverage, Add a layer gallery; Pick card tidy | 5fe04bd2, 3744f6c5, e8f37ded, fe273196, 3b619ebb, c65ed7d8, dcc52c12, 27b267b3, 12170ed6 |

Checks I ran myself on `ux-round3` at 63159aae (before step 2b): quick, browser smoke (Green), `tools-ui`, `workspace`, the engine
tier, `node --test repro/digest-guard.digest.test.mjs` (all four pass since main's efda1e06), and a scripted Pick pass (card on
cliff/grass/plateau, Escape order with the Map and View menus, overlapping reads, picks during and after a redraw, Alt-click under
Mountain, the Surface door, Find "pick"/"share"/"grid"). Step 2b's checks are its implementer's runs: quick, smoke, `workspace`,
`tools-ui`, a 0-pixel byte check.

### Done and reviewed on `ux-round3-materials`, not merged into `ux-round3`

Step 6, the material editor beside the map: it docks in the side panel's column and the map stays live (`show()`, not modal),
Full size toggle, one Escape chain; New material button and a library drawer with lazy swatches (the select is gone); publishing
a control asks for its name; 48 shipped control labels renamed in `materials/textures.json` (renders byte-identical).
Commits 2dce5caf, 4c3d4c45, c60b18cc, 73200ecb, a92c6fdd, 80b9cfa5. The branch also carries step 5's last two commits
(8f3e160e four-column Land flyout, d57436c5 picture boxes with "No picture yet").

### In flight when the session ended (check the worktrees: an implementer may have been cut off mid-edit)

**A. `ux-round3` worktree: Pick's read race, and a Zhon timing question.** At the time of writing `sculpt-canvas.js` had
uncommitted edits. Look at `git status` and `git log 12170ed6..HEAD` first.

- *The race.* A pixel read (`inspect` → `inspectNow` in `sculpt-canvas.js`) queues against other reads but not against the
  canvas's own draws, so a read fired right after an edit can throw "chunk renderer is already rendering" (seen twice by the
  step 2b implementer; the card then says "could not be read" with Read again). Wanted: the read waits for a draw in flight
  (`drawing`, `renderer.busy`, the canvas's scheduling) and then bakes, without waiting for the whole view to reach final; if the
  bake still throws that one error, retry once after the in-flight work ends. No change to what an ordinary draw does. Proof
  wanted: at least 40 reads each fired immediately after an edit (shape edit, undo, material recolor, pan/zoom in turn), plus
  reads 0.9-1.2 s after an edit (main's ring bake), on Green 4 × 4 and 8 × 8; count of throws before and after, longest wait;
  then the browser smoke.
  If the uncommitted diff is there: read it, finish or redo it, run that proof.
- *Zhon.* On a fresh profile Zhon's Export button stayed disabled for over 60 s (observed once). Time editor-ready
  (`#map-export` enabled and `sculptCanvas.idle()`) on the branch and on main, three fresh-profile runs each, Green as control.
  Slower on the branch: find the commit. Slow on both: report it to the owner, do not fix it here.
- A temporary worktree of main may have been left under `/Users/daniel/src/` by that implementer: `git worktree list`, and
  remove it with `git worktree remove` only if it is clearly that one (created 2026-11-16 evening, at main's tip, no branch work).

**B. `ux-round3-materials` worktree: five review fixes.** Two were committed (df330f7f the Manage note's limit; 464cd000 Escape in
a text field leaves the field). Three remained; check `git log 464cd000..HEAD` and `git status`:

1. Docked, the in-editor preview waits for a pause in input (about 90 ms, as the thumbnails do); at Full size it stays immediate.
   Measured cost today: the map gets 5-7 bakes a second during a color drag with the preview running, 9-11 without. Report
   before/after, interleaved, three runs.
2. Docked, the preview shows true 1× pixels (today a 384 px picture is scaled into 291 px, so "1×" is untrue): unscaled and
   cropped to the box, at 1440 × 900 and 1280 × 720; 2× stays a true 2×.
3. Library swatches: in `review-6/3-drawer-search-1440x900.png` Red sand, Archipelago sand and Moon sand are near-black while
   Coral sand and Green sand look right. Compare each tile's swatch with the editor's own Tile preview of that material; fix the
   swatch if it is wrong (a derived material drawn without its base is the first suspect), or show the two pictures if the
   material really looks like that.

Then: quick, `repro/workspace.mjs`, the browser smoke; retake screenshots 1, 3 and 6 of `review-6`.

## 4. What is left, in order

### 4.1 Close A and B above

### 4.2 Merge and land steps 1, 2, 5 and 6 (do this before starting steps 3 and 4)

Landing the reviewed work first keeps the remaining two steps small and gives the owner something to try.

1. Merge `ux-round3-materials` into `ux-round3`. Expect conflicts or near-conflicts in `sculpt-ui.js` (`closeTop`: the Surface
   gallery joined it on one side, the material editor's menus, drawer and Full size on the other; Pick's card and the docked
   editor close after it in `sculpt.js`'s keydown chain), `sculpt-find.js`, `sculpt-workspace.css`, `index.html`, `sculpt.js`,
   `repro/workspace.mjs`. `index.html` and several script files have lines thousands of characters long: resolve by taking one
   side's line and re-applying the other side's small change, and prove it (compare against each parent).
2. One small addition after that merge: a Surface row's "Edit…" opens the material editor, and on close the focus falls back to
   the Materials button because `surfacePanel.refresh()` rebuilt the row. Row buttons now have ids (step 2b), so return focus by
   id. The materials implementer was asked to describe the hook in its last report.
3. Merge `main` into `ux-round3` (at least 9987ce58 and 4cef1a1c are new; both are in the renderer and fields, under Pick's read).
4. Checks on the merged tip, one GPU job at a time:
   - `repro/check.sh quick`
   - `repro/check.sh engine` (the probe writes in `engine-frag.wgsl`; `nodeBounds` was refactored onto `landformExtent` in 8ae759a5)
   - `node --test repro/digest-guard.digest.test.mjs`
   - `repro/check.sh config` (world tool data, `site.json` descriptions, `internal/site/config.go`)
   - `repro/check.sh browser --server http://127.0.0.1:8993 --port 9493 --worlds green`, and once with `--worlds desert` or the
     id Painted Desert uses (materials were renamed for every world)
   - `node repro/tools-ui.mjs`, `repro/workspace.mjs`, `repro/rock-presets-ui.mjs`, `repro/share.mjs`, `repro/passability.mjs`,
     `repro/ui-finish.mjs`, each with `--server` and `--port`
   - `node --test repro/find.test.mjs repro/surface-panel.test.mjs repro/surface.test.mjs` are in quick
   - A scripted pass like the one in section 3 (Pick; Escape with the Map menu, View menu, Surface gallery and the docked editor
     each open; Find for "pick", "share", "grid", "snow", "materials"; every door into the material editor).
   - Known to fail the same way before this round, so not yours: `repro/check.sh site` (stops at the stale-previews gate),
     `repro/features.mjs` at its line 112, `repro/ui-create-curves.mjs` (hangs clicking Hill after its first-run step).
5. Look at the editor yourself at 1440 × 900 and 1280 × 720 on Green and one other world: first visit, draw a mountain and a lake,
   Pick the cliff, recolor from the card, undo, open World › Surface, add a layer from the gallery, open the material editor from
   the card and drag a color. The owner judges looks; you judge that nothing is broken or unreadable.
6. Remove this file if nothing else is going to land from the branch (otherwise keep it until the last landing), then land:
   `git -C /Users/daniel/src/terraform status` must be clean and on `main`; `git -C /Users/daniel/src/terraform merge --no-ff ux-round3`.
   If main moved again since step 3, merge it into the branch first and rerun what the new commits could affect.
7. Restart the owner's editor on 8801 (standing instruction; the command and log are in memory `owner-editor-port-8801.md`:
   stop the process listening on 8801, then from `~/src/terraform` run
   `go run ./cmd/terraform --port 8801 --assets-root /private/tmp/nanolathe-map-editor` detached, output appended to
   `~/terraform-assets/server-8801.log`; run `go run ./cmd/previews fetch --replace` first only if the landing moved the preview
   pin, which this one does not). Confirm it answers. Do not push.
8. Update the memory files (section 8) and tell the owner what landed, with the decisions in section 7.

### 4.3 Step 3: World home, and the rock type page headline-first (one implementer, three commits, on a branch cut from the landed main)

Decided (the owner's "Use your defaults"): five World cards, the Colors section dissolved, **one fixed headline list for every
world** (a data move, no exception to the layout rule).

How World rows are placed today: `WORLD_HOMES` in `sculpt-ui.js` maps each key to "Section/Tab"; `index.html` holds one container
per home (`data-home`), and rows are created straight into their home. `repro/world-homes.test.mjs` holds every key to one home.
So moving a headline row is: add a container for the new home in `index.html`, change the key's entry in `WORLD_HOMES`.

**(a) Rock type page.** Seven existing keys move to a headline block at the top of the rock type page (above its nine tabs, under
the picker) and leave their tabs: `faceWhole`, `faceBlockSize`, `faceBed`, `faceWear`, `crackSeverity`, `faceScratch`, `runoff`.
- Names for what is seen. Today's labels are in `sculpt-knobs.js`: `faceBlockSize` is "Joint spacing (px)" and becomes
  "Block size (px)"; **`crackSpacing` is already "Block size (px)"** and must become "Crack spacing (px)" so there are not two;
  `crackSeverity` is "Frost (crack depth; …)" and becomes "Crack depth". Have the implementer table the seven old → new names and
  grep for every place a label is used as text (`worldControlRequirement` messages in `sculpt-control-schema.js`, Find's
  `SYNONYMS`, tests, docs).
- Block size sits under Whole blocks with a line saying it reads once blocks are whole (tested by eye in the review: alone it
  barely changes the look; with Whole blocks at 1, Joint spacing 7 → 24 moved 38% of pixels). Runoff's dependent rows already
  fold ("Show 4 unavailable settings"); keep that pattern.
- The Pick card has its own list (`ROCK_HEADLINES` in `sculpt.js`, three keys): make it read the same one list.
- The nine tabs stay. `repro/rock-presets-ui.mjs` and `repro/workspace.mjs` assert tab counts and row places: update them.

**(b) Colors dissolved.** World › Colors today holds the shallows' tint and the sun and sky colors (the ground's, water's, rock's
and layers' colors already live with their owners). Shallows move to Water & shores, sun and sky to Light & shine, and the
section and its nav entry go. Pick's "Colors ›" door (`openColors` in `sculpt.js`, which opens `wsec-colors`) must follow the
shallows' row to its new place; Find indexes that section too.

**(c) World home.** The World section (`wsec-world`, which today holds the world picker, "Restore built-in settings", a name
field with "New world", export and import) becomes the home:
- Head: the world's name and picker, the scope tag, a count of changes from the built-in world (count what the store already
  holds as overrides; no new bookkeeping), Reset (today's restore action, moved: check what it really resets; `world-reset`
  resets colors only), and "Save as new world…" (reveals the name field; uses `makeWorld` in `sculpt.js`).
- Five cards, each with a few headline rows and an "All … settings ›" link that opens today's section unchanged:
  - **Ground**: the ground material's chip and color with "Edit material ›"; `groundPatchSize`, `reliefAmount`.
  - **Water**: the water material's chip and color, the shallows' tint, `shallowDepth`.
  - **Rock types**: a chip per rock type (click opens its page), with a dot on those a shape in view uses and one line when
    none is ("Nothing in view uses Greenstone"). "In view" from the shapes' footprints against the view rectangle
    (`landformExtent`, `rocksBeneath` in `sculpt-rock-presets.js` already exist); no GPU read.
  - **Surface layers**: the Drawing section's layers as lines (name · Coverage), links into the list, "+ Add a layer",
    "n draw here · m more". Lines, not second sliders: a row has one home.
  - **Light & weather**: sun and sky colors, `sunHeight`, `erosionRain` (it carries the "This map" tag if it is map-saved:
    check).
  - Foot line: Export world · Import.
- A headline row leaves its tab. In the tab it left, one short line at the top says which rows are on the home, as a link.
- Substitute a key from the same tab if one of the above turns out not to matter visibly on Green, and say so; do not add
  macro sliders or new controls.
- The nav keeps the other sections (Vegetation, Cliffs & stones, Sand, Rain & erosion) behind "All".

Checks: quick (`world-homes.test.mjs` updated to the new homes), smoke, `workspace`, `rock-presets-ui`, Find queries for a moved
row ("sun height", "block size", "shallow"), a byte check that no render changed (labels and places only), undo of a headline row.

### 4.4 Step 4: the world carries its tools and rock types (R1), on its own branch after step 3

Decided: in a world of your own, Save as tool and Add a rock type save **to the world** by default; in a built-in world, to the
map. Background is `docs/UX_WORKFLOWS.md` on branch `ux-review` (R1, "the world is the kit").

- Today a custom world in the browser's world store (`worlds[id]` in `sculpt.js`: name, base, colors, knobs, materials,
  featureSet, surface) holds no tools and no rock types; a map's own tools (`map-1`, …) and rock types (slots 1-15) are saved
  with the map only. A built-in world's are data (`materials/<world>.json` `world.tools`, `world.rock`).
- Build: the stored world gains its own tools and rock types; a map opened in that world sees them as the world's (toolbar, Look
  picker, rock picker); Save as tool and Add a rock type get a "Save to" choice (this world / this map) with the default above,
  and say where it went; world export/import carry them; `makeWorld` copies them in **both** its branches (from the page's world,
  and from a stored world); a tool saved to a world takes a family (offer the world's families; none falls under "Other" in the
  Land flyout, which is what a map tool does today).
- Design questions the implementer must answer before building, in a short note to you: how rock slots are shared (a map's rock
  types and the world's draw from the same 15 slots; what a map does when its world later adds one); what happens to a map that
  used a world tool or rock type when it is opened where that world is absent (today a stroke with an unknown tool shows as the
  generic landform, and a map carries its world: check `adoptWorldMaterials` for the pattern); undo (a world edit is a world
  setting: R3 made World rows undo, follow that).
- No new storage key, save format or page: the world store and the map file are the two places.
- "+ New world from …" is already in the Start a map dialog (step 5), so the proposal's "then New world in the start dialog" is
  done apart from copying tools and rock types.

Checks: quick, `repro/check.sh config`, smoke, `tools-ui`, `rock-presets-ui`, `save-load`, `share`, and a scripted round trip:
make a world, save a tool and a rock type to it, open a new map in it, export the world, import it in a fresh profile.

### 4.5 Final

Land steps 3 and 4 the same way as 4.2 (merge main, the checks their changes can break, look yourself, merge into local main,
restart 8801, no push), delete this file, update memory, report.

## 5. Briefing an implementer

Each brief so far gave: the worktree, branch and tip; "read CLAUDE.md first"; own server port, CDP ports and assets root, and
that scratch files stay under that root (one implementer overwrote another's helper in a shared temp folder); the task as
numbered parts with what must keep working; the checks to run; what the report must contain (commits, measured numbers, by-eye
claims, unfinished, beyond the brief); where to save five or six 1440 × 900 full-page screenshots; "stop your server and Chrome,
delete your profiles"; "do not land, merge, push, rebase or amend"; the commit trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (your own merge commits end with your own trailer).
Tell an implementer what to do when the task runs long (commit the finished part, hand back, list the rest).

## 6. Decisions already made (do not reopen)

- Five World cards; Colors dissolved; one fixed headline list (step 3).
- Save as tool and Add a rock type go to the world in a world of your own, to the map in a built-in world (step 4).
- No new world or tool pictures in this round (they need a preview render and a publish, which are the owner's).
- Pick answers "which rock is drawn here"; the shape card may still say "Varies" beside other rock (a default plateau reaches
  about 966 px from its path), and that was accepted.
- Until release, saves and share links are no compatibility promise (CLAUDE.md rule 7).

## 7. Things to tell the owner when reporting (their call, not fixes)

- Land flyout: family headings and the word "Other" are built by script under the shape-button exception; Landform and Fissure sit
  in a "Generic" group at the end rather than first; at 1280 × 720 eight of ten worlds' flyouts still scroll (none at 1440 × 900).
- "+ New world from …" makes the world at once; cancelling the dialog leaves it in the store.
- Save moved from the top bar into the Map menu.
- Pick's swatches were tested with synthetic input events; a real color-picker drag is unverified. The card can cover the pixels
  beside the pick. While Pick is in hand the Build panel is empty.
- Material editor: Build, World and the side-panel toggle close it, picking a tool does not; Escape no longer clears the graph
  selection first; the drawer's Enter takes the first match (for a library tile that adds a copy).
- The 48 control renames: maps and worlds already stored in a browser keep the old names, the world store now reads those
  materials as edited, and later library revisions will not reach those copies.
- `SURFACE_NEEDS` makes no claim for Rock, Sand and Chips (always under Drawing), and Base band lists under Drawing on a world
  with strength and strata above 0 but no rock column, where it draws nothing.
- Previews are stale (they were before this round; `engine-frag.wgsl`, `materials/*.json` and `sculpt.js` changed again). Lush's
  Start a map picture is missing from the bundle. Tool pictures on other worlds show Green's art.
- Four tools' first help sentence is still too long for the footer (ramp, river, braided, paint).
- World's own search box (`#world-search`) is still there beside Find.
- Zhon's slow first start, if it reproduces on main.

## 8. Housekeeping

- Memory to update after each landing: `ux-workflows-review.md` (round 3 status), and the `MEMORY.md` index line.
- Disk is about 91% full. Delete Chrome profiles and check outputs after use (`rm -r` on exact paths); keep the review folders
  until the owner has seen the report.
- A shell hook rewrites some commands (`rtk`): piped `grep` and `git diff | grep` can print nothing. Write the output to a file
  and read that. If a Bash call is refused with "no verdict", reissue it alone.
- Headless Chrome screenshots: use full-page captures and crop offline; clipped captures differ run to run.
- Display sleep breaks the Chrome checks; one GPU job at a time (engine tier and Chrome do not share well).
- `git diff main..HEAD` misleads once main has moved: use `main...HEAD`.
