# Retail match: brief for a matching agent

You are matching one Total Annihilation world's retail look with Terraform's
editor, using only the world's data: its controls, rock types, materials,
surface layers and tool presets. Where the data cannot reach a look, you
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
already exists, add a suffix (`match-green-2`): each worktree name gets its
own output folder and trial log.

```text
Read docs/retail-match/README.md and follow it for world <world>.
Make your worktree from main:
  git worktree add ../terraform-wt-match-<world> -b match-<world> main
Budget: 60 trials. Write your report to <out>/REPORT.md as the brief says,
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
| `materials/<world>.json` | `world.knobDefaults`, `world.rock`, `world.surface`, `world.materials`, `world.shapes`, `water` | look |
| `materials/textures.json` | materials used only by your world, or new ones named `<world>-...` | look |
| `repro/scenes/<world>-<n>.json` | stroke cards, only where the window's strokes do not follow the retail heights | shape |

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
   There is one crop per class that retail has enough of: `water`,
   `shore`, `level`, `slope` and `steep`. Each trial's printout ends a
   window with a `look:` line naming the crops of its largest findings.
   For each window, write down what differs most. Shape comes first: does
   our ground rise where retail's does? Then where things show: rock, sand,
   grass. Then texture, then color.
2. **Pick one difference and a lever.** Use PLAYBOOK.md's tables. Prefer the
   lever that fixes the cause:
   - a material for what a surface is made of;
   - a surface layer for where it shows;
   - a rock type for how rock is built;
   - a World control for light, relief and effects.
3. **Try it.**
   - **One World control:** `sh repro/match.sh <world> --probe key=a,b,c
     --note "why"` sweeps values without editing a file.
   - **Anything else:** edit the files, then `sh repro/match.sh <world>
     --note "what and why"`.
   
   Every trial is validated, rendered, scored and logged with its diff.

   **A trial or probe renders the files as they are now, uncommitted edits
   included.** A probe after an uncommitted edit measures both together.
   To measure one control alone, commit or revert your edits first. Its
   printout's `renders:` line says which. Compare with "vs previous", not
   just "vs base", when trials build on each other.
4. **Keep or revert.** Open the trial's crops for the classes you aimed at
   (the `look:` lines) before you decide. A keep without that look is not
   allowed. Keep a change only when all of these hold:
   - the finding you aimed at clears or shrinks ("cleared since base" in the
     printout, or a smaller number in `classes.md`);
   - the crops look closer by eye;
   - the mean score does not rise, and no window gets worse by more than
     0.03.
   
   The whole-window look score is blunt. In the pilot, turning green-1's
   solid rock band into retail-like cracks was a clear win by eye, and it
   cleared two steep-class findings, but the window's look score did not
   move. Do not wait for that score to fall before keeping a change that the
   class findings and your eye agree on.
   
   To keep it:
   - commit it with a message that says what changed, why, and the scores
     before and after, with the trial id;
   - run `sh repro/match.sh <world> --keep-trial <trial>`, so its pictures
     survive pruning. Do the same for any trial your report cites. Only the
     last three trials keep their pictures otherwise.
   
   To revert it, restore the files (`git checkout -- <file>`).
5. **Checkpoint every 10 trials or so.**
   - Run `sh repro/match.sh <world> --log` and look at the trend.
   - Open the latest pairs at full size.
   - Run `sh repro/match.sh <world> --holdout --note "checkpoint after
     <trial>"`. It compares with `holdout-000`, which the first run renders
     from the committed files. If your kept changes help the windows you
     tuned on but hurt the held-out one, they fit those windows rather than
     the world: reconsider them.
6. **Stop** when you hit any of these:
   - your trial budget (default 60 trials, unless your task says
     otherwise);
   - no lever moves the remaining gaps;
   - the remaining differences need things the editor does not have.
   
   Then write the report.

## Rules of evidence

- **Numbers come from the trial log**, not from memory. Quote the trial id.
- **"Renders exactly as the base"** means your change reached none of the
  windows. That is not the same as a control that does nothing. Find out
  why (PLAYBOOK.md, "When a control moves nothing") before you write it
  down as evidence. A `--query` key the page does not read is refused before
  anything renders.
- **Claims you make by eye cite a crop or pair path.** A model that sees
  pictures can be fooled into seeing a match. If the numbers and your eye
  disagree, say so, and do not keep the change.
- **Scores can be gamed.** In past rounds, a flat gray matched retail's
  average brightness, scattered dark boulders improved a score, and
  blotches added "texture". Reject any change that improves a score by
  painting something retail does not have.
- **Judge at 1x.** TA's detail is one art pixel: grit, cracks, single-pixel
  edges. The crops are doubled so you keep it. Do not judge from
  thumbnails.
- **Fix the shape before the color.** A class whose share differs (the
  `share` findings) is a shape gap. Coloring it will not fix it.

## The shape lane

A window's strokes rebuild a retail map's landforms
(`<out>/<trial>/scenes/<window>/layout.png` shows both height reliefs).
Edit a scene only when its strokes clearly do not follow the retail
heights, and keep every such change in its own commit, with a message that
starts with `fixture:`. If the strokes follow and the shape is still wrong,
the presets or the engine are the problem: write a proposal.

A scene's `query` beats the world's defaults, for example `undulation=3`.
In the look lane, leave scene queries alone, and remember they override
what you set in `knobDefaults`.

## The report

Write `<out>/REPORT.md` following [REPORT.md](REPORT.md). Its proposals use
a fixed format, so each one can be checked and built. Proposals are the
main product when the data cannot reach retail. Make each one specific:

- the window, class and finding;
- every lever you tried, with trial ids;
- what is missing, and what to build.

Then commit your work on the branch and stop. A reviewer will look at the
pairs, the log and your report, and decide what to port into the world.
