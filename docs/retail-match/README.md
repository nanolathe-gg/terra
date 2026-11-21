# Retail match: brief for a matching agent

You are matching one Total Annihilation world's retail look with Terraform's
editor, using only data: the world's controls, rock types, materials, surface
layers and tool presets, and each retail map's own choices from that kit
(which rock type and ground its strokes use, their steps, its ground relief).
Where the data cannot reach a look, you
write down why, with evidence, and what the editor would need. Both results
count. A clear, evidenced "cannot, because..." is as useful as a match.

This brief works with any coding agent that can run shell commands, edit
files and open PNG images. It assumes no particular tool or model.

Read, in this order:

1. this page (the task, the rules and the loop);
2. [PLAYBOOK.md](PLAYBOOK.md): every lever, when to use it, and the
   symptom-to-lever tables;
3. [ATLAS.md](ATLAS.md): where the retail pictures, maps and sections are;
4. `worlds/<world>.md`: your world's windows, what to look for, and what is
   known. If it is missing, writing it is your first task (see the end of
   ATLAS.md);
5. `<out>/REFERENCE.md`, which `repro/match.sh` writes. It lists every
   control, material node, surface fact and rock setting, with its range and
   your world's current value. It is generated from the code, so trust it
   over any other list.

AGENTS.md (the repository's rules) applies in full. This brief narrows it
for this task: where they differ, follow the stricter one.

## Handing this to an agent

Paste this into any coding agent started in the main checkout, with
`<world>` and the budget filled in. If a worktree or branch with that name
already exists, add a suffix (`match-green-3`): each worktree name gets its
own output folder and trial log.

```text
Read docs/retail-match/README.md and follow it for world <world>.
Make your worktree from main:
  git worktree add ../terraform-wt-match-<world> -b match-<world> main
Budget: 300 trials. Write your report to <out>/REPORT.md as the brief says,
commit only on your branch, and do not land, merge or push.
```

## Setup

```sh
git worktree add ../terraform-wt-match-<world> -b match-<world> main
cd ../terraform-wt-match-<world>
export PYTHON=/Users/daniel/src/terraform/.venv/bin/python   # numpy, scipy, Pillow
sh repro/match.sh <world>             # the bases, trial-000 and holdout-000; about a minute
```

The commands need:

- `$R` (default `/tmp/nanolathe-map-editor`), a symlink to the retail
  assets;
- Dawn's Node binding, for headless rendering (`repro/headless.mjs` says how
  to install it);
- the project's Python environment (`PYTHON`, as above);
- Go.

If the base trial fails, stop and report the error. Do not work around it.

Your output folder is `$R/match/terraform-wt-match-<world>/<world>/`
(`<out>` below). Everything retail-derived stays there.

## What you may change

| File | What | Lane |
| --- | --- | --- |
| `materials/<world>.json` | `world.knobDefaults`, `world.rock`, `world.surface`, `world.materials` (with `extra`), `world.shapes`, `water` | look (every window) |
| `materials/textures.json` | materials used only by your world, or new ones named `<world>-...` | look (every window) |
| `repro/scenes/<world>-<n>.json` | stroke cards' `rockPreset`, `groundPreset` and shape options (Steps, gullies, cracks, curve...); the query's `undulation*` keys and the map's own `sea` and `plain` (its plain's height above the sea; a low-floored retail map gets the game's whole 0-255); the map's own water in the query (`shallowDepth`, `deepDepth`, `bedTint`, `bedBright`, `bedContrast`, `bedCracks`, `bedRelief`, `bedFlat`, `wetBand`: a river that stays light against a sea that darkens early); the scene's own `surface` (the world's layer list, copied whole, with this map's amounts: a map holds its world's settings, owner 2026-11-19) and `materials` (its own grounds); new `paint` strokes that lay a ground, or paint a style or override (Relief, Cracks, Banding, Relaxation, Deposits, Vegetation, Rock exposure; REFERENCE.md, "Paint channels") where the retail map differs | map (that window) |
| `repro/scenes/<world>-<n>.json` | stroke points, `diameter`, `elevation`: only where the strokes do not follow the retail heights | shape (that window) |

**The look lane** is the world: one answer for every window. **The map
lane** is what one retail map chose from the world's kit, which differs from
map to map: green-1 is broken hills, green-5 a stepped ridge. When a world
change helps one window and hurts another, look for the map choice
(PLAYBOOK.md, "Maps"). A map choice may only pick from the world's kit: to
give green-5 a rock or ground of its own, add the rock type or material to
the world (look lane files), then choose it in green-5's scene.

Change nothing else:

- no `.js`, `.wgsl`, `.go`, `.py` or `.sh` files, and no other world's file;
- before you edit a material in `textures.json`, check that only your world
  uses it, including other materials' `like` entries (`grep -n '"<key>"'
  materials/*.json`). If another world uses it, copy it to a new
  `<world>-...` key and point your world at the copy;
- never commit anything retail-derived (pictures, heights, crops), and
  never write into `~/TotalAnnihilation`;
- add no dependencies;
- do not land, merge or push. Commit on your branch only.

## The loop

1. **Look before you change anything.** Read the base trial's printout and
   `<out>/trial-000/classes/classes.md`. Open the crops of the largest
   findings (`<out>/trial-000/classes/crops/<window>/<class>.png`, retail
   left, ours right, at 2x) and each window's `scenes/<window>/pair.png`.
   There is one crop per class that retail has enough of: `deep` and
   `shelf` water, `shore`, `flat` and `gentle` ground, `slope` and `steep`
   (PLAYBOOK.md, "Symptom to lever", says where each starts). Each trial's printout ends a
   window with a `look:` line naming the crops of its largest findings.
   For each window, write down what differs most. Shape comes first: does
   our ground rise where retail's does? Then where things show: rock, sand,
   grass. Then texture, then color.

   Then break each window into its stages (see "Stages" below):
   `sh repro/match.sh <world> --stages`. Start with the retail read, before
   you look at ours. Then read `stages.md` and the sheets. The stage that
   carries a gap tells you which kind of lever to reach for first.
2. **Pick one difference and a lever.** Use PLAYBOOK.md's tables. Prefer the
   lever that fixes the cause:
   - a material for what a surface is made of;
   - a surface layer for where it shows;
   - a rock type for how rock is built;
   - a World control for light, relief and effects.
3. **Try it.**
   - **Name your target.** Add `--aim <window>:<class>:<metric>` (for
     example `--aim green-2:slope:lines`, the finding's key) to every trial
     and probe. The log follows each gap you aim at and says when it stalls
     (see "When a gap stalls"). Without it, the log has to guess your target
     from what moved.
   - **One World control:** `sh repro/match.sh <world> --probe key=a,b,c
     --note "why"` sweeps values without editing a file. A `--probe` or
     `--query` value beats the scenes' own (the printout says when).
   - **Anything else:** edit the files, then `sh repro/match.sh <world>
     --note "what and why"`.
   - **One window's scene (the map lane):** add `--window <world>-<n>` to
     render only that window, about 20 s instead of a minute. Use it only
     for a change no other window can see; a world change judged on one
     window prints a warning.
   
   Every trial is validated, rendered, scored and logged with its diff and
   the levers it moved.

   **A trial or probe renders the files as they are now, uncommitted edits
   included.** A probe after an uncommitted edit measures both together.
   To measure one control alone, commit or revert your edits first. Its
   printout's `renders:` line says which. Compare with "vs previous", not
   just "vs base", when trials build on each other.
4. **Keep or revert.** Open the trial's crops for the classes you aimed at
   (the `look:` lines) before you decide. A keep without that look is not
   allowed. Keep a change only when all of these hold:
   - the finding you aimed at clears or shrinks by a third or more
     ("cleared since base" in the printout, or a smaller number in
     `classes.md`). A finding listed as "just under the threshold" moved a
     little across the line: that is not a clear;
   - the crops look closer by eye;
   - **a world change:** rendered on every tuning window, the mean score
     does not rise, and no window gets worse by more than 0.03;
   - **a map change:** its window's look does not rise, and the choice is
     one a map artist would make for that map (a rock type, a ground, steps,
     relief), not a patch painted to move a number.
   - **a map's own surface layers, grounds or water** (a scene's `surface`,
     `materials`, or its query's water keys): the same, and the held-out window cannot check them, so
     each needs a by-eye reason in the report: what this retail map shows
     that the world's list draws wrong (round 9: green-3's grades are clean
     where the world's gentle lumps draw). Copy the world's list whole and
     change only amounts or rules; a scene list that matches no world
     layer is a new world, not a map choice.
   
   The whole-window look score is blunt. In the pilot, turning green-1's
   solid rock band into retail-like cracks was a clear win by eye, and it
   cleared two steep-class findings, but the window's look score did not
   move. Do not wait for that score to fall before keeping a change that the
   class findings and your eye agree on.
   
   To keep it:
   - commit it with a message that says what changed, why, and the scores
     before and after, with the trial id. Start a map change's message with
     `map: <world>-<n>:` and a shape change's with `fixture:`;
   - run `sh repro/match.sh <world> --keep-trial <trial>` right away, so
     its scene pictures survive pruning. Do the same, at once, for any
     trial whose whole scene you may cite. Every trial keeps its class
     crops (`classes/crops`), but only the last eight keep their scene
     pictures and triptych otherwise, and a mark made after they are gone
     keeps nothing (round 1 lost the pictures of every trial its report
     cited that way). Cite a crop before you re-render a trial to see it.
   
   To revert it, restore the files (`git checkout -- <file>`).

   **When your eye overrules the numbers, record it.** That means dropping a
   change the numbers liked, or keeping one they did not. Run
   `sh repro/match.sh <world> --verdict trial-NNN drop --why "..."`. These
   records are how the harness learns which numbers to trust (see
   "Calibration").
5. **Checkpoint every 25 trials or so.**
   - Run `sh repro/match.sh <world> --log` and look at the trend, and at
     its count of trials per kind of lever. If one kind dominates, turn to
     the kinds you have not tried (PLAYBOOK.md, "Use every kind of lever").
   - Update `<out>/NOTES.md`: what you kept and why, what you ruled out
     (with trial ids), and what you plan next. A long round outlives your
     memory of its start; these notes and the log are how you, or the agent
     after you, carry on.
   - Open the latest pairs at full size.
   - Run `sh repro/match.sh <world> --holdout --note "checkpoint after
     <trial>"`. It compares with `holdout-000`, which the first run renders
     from the committed files. If your kept changes help the windows you
     tuned on but hurt the held-out one, they fit those windows rather than
     the world: reconsider them.
6. **Stop** when you hit any of these:
   - your trial budget (default 300 trials, unless your task says
     otherwise);
   - no lever of any kind moves the remaining gaps: World controls, rock
     types, materials, surface layers and, window by window, the map lane;
   - the remaining differences need things the editor does not have.
   
   A round of 300 trials is long. Do not stop early because the mean score
   has stopped moving: the class findings and crops are the measure, and
   materials and the map lane take many trials to explore.
   
   Then write the report.

## When a gap stalls

The trial printout and `--log` flag a gap as **STALLED** when 8 attempts
aimed at it (a probe sweep counts as one) have not shrunk it by 15% from its
best, across 3 or more kinds of lever. **STALLING** means the same, but with
fewer kinds tried: try the other kinds first. A stalled gap is the signal to
stop tuning it and find out why:

1. **Find the stage.** Run `sh repro/match.sh <world> --stages --window
   <window>` and read that class's row in `stages.md` and its
   `sheets/<window>/<class>.png` (see "Stages"). The largest trusted stage
   gap names the kind of lever that can reach it.
2. **Check that kind was really tried.** If the stage is placement and no
   surface layer trial aimed at the gap, it has not stalled. It is untried.
   Go back to the loop.
3. **Test the missing property with an oracle trial.** Write the smallest
   shader change that adds what the stage lacks, and run it as an oracle
   trial (see "Oracle trials"). If the gap closes and the crops look closer,
   you have shown what the engine needs. If it does not close, the missing
   piece is something else: look again before you propose it.
4. **Write the proposal** with the oracle trial's id, numbers and crops
   (REPORT.md, section 6, "Oracle"). If no shader change can test it (a new
   tool, a stroke option, a new fact), say so and say why.

Then move on to another gap. A stalled gap is not a reason to stop the
round.

## Stages

`sh repro/match.sh <world> --stages [--window W]` breaks each tuning window
into the stages a terrain picture is made of, retail beside ours, and writes
`stages-NNN/stages.md` with the sheets (`repro/match_stages.py`). Retail is
one finished picture, so its stages are estimates. Each estimator runs the
same way on retail's picture and on ours. Our engine's own views (Clay, the
unlit material, the picture before the dither, our real heights) check the
estimator: a `?` marks a stage whose estimate does not recover our own view
there (its trust is under .5). Read an untrusted stage by eye only.

| Stage | Retail's estimate | Our engine's view | A gap here points at |
| --- | --- | --- | --- |
| height | its 16 px heights | our real heights | the shape lane (strokes, Steps, the map's ground relief), landform options, or a shape proposal |
| light | the step within each palette ramp | Clay | relief: rock type faces and cracks, a material's relief (Light nodes), World relief controls. The lighting itself is the owner's |
| placement | which palette ramp (the paint) each pixel uses | the unlit material | where things show: surface layers and their rules, which material a rock type or layer draws |
| predither | the picture blurred 1 px | `palette=off` | texture in the material itself: grain, patches, cracks (the material graph, rock type cracks) |
| dither | what the 1 px blur removed | our final picture | the output stage. The owner keeps it unchanged (decision 25): report it, do not chase it (the class `dither` finding is report-only and never stalls) |

Finer height detail than the 16 px heights is not recovered from the
picture. Measured on red-3: shape from shading on our own render matched our
own detail heights at a correlation of only .06. Our Clay render follows our
height gradient at .66 at 64 px but only .12 at 4 px, so fine shading most
likely comes from the material's relief rather than the heights. Compare fine
relief in the light stage instead.

**The retail read.** Before anyone looks at ours, a fresh agent reads each
window's `sheets/<window>/retail.png` (retail's five stages alone). For each
stage it writes what the original artist most likely made: the landforms
behind the heights, the light and relief, which paint goes where and by what
rule, the texture before the dither, and the dither. It writes this to
`$R/retail-reads/<window>.md`. Write it once per window and reuse it in later
rounds, so the read does not drift toward whatever ours looks like. It is
text, never a picture: no traced masks or shapes.

**Stages are not a license to paint.** A placement gap says the world's
rules put paint in the wrong place. Fix the rule (a surface layer's
condition, a rock type's material), not the map. The trial printout counts
each scene's paint strokes against the base. A new paint stroke needs the
by-eye reason a map's own choice needs (step 4 above), and it never copies a
stage map. The goal is retail's look from the world's own rules.

## Oracle trials

An oracle trial tests what an engine change would do before anyone builds
it: `sh repro/match.sh <world> --patch change.diff --note "..." --aim ...`.

- The patch is a `git diff` of `.wgsl` files only. Make it in your
  worktree, save it outside the checkout, and restore the shader at once
  (`git checkout -- engine-frag.wgsl`). Never commit it.
- The trial renders with the patched shaders from a fresh folder of its own
  and is logged as `oracle-NNN`. It is never kept and never ported as is,
  and it is not the base or the previous trial for the trials around it.
  `--stages --patch` shows its stages.
- Keep the patch small and aimed at one property: for example, more relief
  at 16-32 px on banks, or a broad pattern reaching deep water. If it
  clears the gap, cite it in the proposal. If it does not, that is evidence
  too.
- Spend at most about one trial in ten on oracles. They answer "what would
  help", not "what to keep".

## Calibration

The class metrics are only worth the weight the eye gives them.
`$PYTHON repro/match_calibrate.py <out>[:<branch>] ...` counts, for each
judged change, which way each class gap moved, and reports how often each
metric agreed with the judge, with the count and who judged. Judgements come
from `<out>/verdicts.jsonl`, which `match.sh --verdict trial-NNN keep|drop
--by owner|reviewer|agent --why "..."` writes, and from a round branch's
commits (a keep by the round agent, which the numbers partly chose, so it
agrees by construction).

A reviewer records every keep or drop decided by eye, and every owner call.
A metric that agrees with the owner's and reviewers' calls no more often
than chance becomes a proposal to re-weight it or drop it from the findings.
It is not changed on thin data.

Class metric version 2 added edge direction (`horizontal`), the dither's
strength (`dither`) and the palette indices a class uses (`palette`). A base
scored by an older version is re-scored from its kept pictures at the next
trial. The window shape and look scores did not change.

## Rules of evidence

- **One metric counts at most 3 family band widths** in a window's score
  (`retail_gap.py`, `GAP_CAP`): red-3's waterline drew 230 thin dark
  pixels in a million, 7 band widths on Red's narrow band, and made up half
  its look score. The printout shows the uncapped value with "(counts 3)".
- **Renders are deterministic.** The same files render the same bytes, so
  any score change between two trials is real, never noise (round 8 called
  a .013 rise noise).
- **Numbers come from the trial log**, not from memory. Quote the trial id.
- **"Renders exactly as the base"** means your change reached none of the
  windows. That is not the same as a control that does nothing. Find out
  why (PLAYBOOK.md, "When a control moves nothing") before you write it
  down as evidence. A `--query` key the page does not read is refused before
  anything renders.
- **Claims you make by eye cite a crop or pair path.** A model that sees
  pictures can be fooled into seeing a match. If the numbers and your eye
  disagree, say so, and do not keep the change. When you try several
  values, keep the one both prefer: round 3 kept a line darkness of .5,
  which cost its window .03, although its own trial at .65 scored better
  and looked as right.
- **Say what moved, and where.** A keep's description names the class
  that changed, read from the trial's numbers and crops, not from what you
  meant to change. Round 3 wrote that its water change textured the shelf;
  it had put flecks on the open water instead (now `deep`, not `shelf`).
- **Read the code before you write that a node or control does nothing.**
  Round 3 reported that an unwired Scatter node reads zero; it reads the
  pixel's position (`sculpt-materials.js`, `programSource`), and only a
  disabled node gives zero. Its dots were 0.7 px, which is the likelier
  reason they did not show. Round 4 wrote that the shelf cannot take a
  fine speckle, but never tried `bedContrast`, the control that carries the
  bed's grain into the shelf; and that a shape preset cannot reach a
  window, from a trial that changed a shape no window draws. Round 5 wrote
  that a rock type's new material was not bound because the map's table
  was full. REFERENCE.md's "Rock slots" table shows each rock type's
  material and how full the table is, and it was bound (15 of 23 slots).
  Its moss material had kept the gray rock's `color` key, which recolors
  the whole graph; without it the face turned green. Cite that table, and
  read the material's own keys, before you write that a material is not
  used.
- **Scores can be gamed.** In past rounds, a flat gray matched retail's
  average brightness, scattered dark boulders improved a score, and
  blotches added "texture". Round 4 matched green-5's plain edge count
  with specks darker than nearly every pixel retail draws there. Reject any
  change that improves a score by painting something retail does not have,
  and check the class's `dark` and `light` findings before you keep a
  texture change.
- **Judge at 1x.** TA's detail is one art pixel: grit, cracks, single-pixel
  edges. The crops are doubled so you keep it. Do not judge from
  thumbnails.
- **Fix the shape before the color.** A class whose share differs (the
  `share` findings) is a shape gap. Coloring it will not fix it.
- **"Cannot" needs every kind of lever.** A proposal that says the data
  cannot close a texture or color gap cites tries with a material and a
  surface layer, and for a gap only some windows have, the map lane. Quote
  the `--log` count of trials per kind of lever in the report.

## The shape lane

A window's strokes rebuild a retail map's landforms
(`<out>/<trial>/scenes/<window>/layout.png` shows both height reliefs).
Move strokes (their points, `diameter`, `elevation`) only when they clearly
do not follow the retail heights, and keep every such change in its own
commit, with a message that starts with `fixture:`. If the strokes follow
and the shape is still wrong, try the map's own choices first (Steps, the
ground relief `undulation*` in the scene's query), then write a proposal.

A scene's `query` beats the world's defaults: every Green scene sets
`undulation=3`, so `world.knobDefaults.undulation` reaches none of them.
The validator warns about such a default, and refuses a scene query key
that is not the map's ground relief.

## The report

Write `<out>/REPORT.md` following [REPORT.md](REPORT.md). Its proposals use
a fixed format, so each one can be checked and built. Proposals are the
main product when the data cannot reach retail. Make each one specific:

- the window, class and finding;
- every lever you tried, with trial ids;
- what is missing, and what to build.

Then commit your work on the branch and stop. A reviewer will look at the
pairs, the log and your report, and decide what to port into the world.

If your tool will not let you write `<out>/REPORT.md` (some agent runners
refuse report files from a delegated agent), put the whole report in your
final message instead; the reviewer saves it there. Keep running notes in
`<out>/NOTES.md` as you go: round 6 ran out of working memory at 94 trials,
and its notes carried the round.
