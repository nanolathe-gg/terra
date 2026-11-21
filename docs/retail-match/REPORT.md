# Report template

Write `<out>/REPORT.md` with these sections, in this order. Mark every claim
**measured** (with the trial id and the number) or **by eye** (with the crop
or pair path).

## 1. Summary

Three to five sentences:

- where the world started (trial-000's mean shape and look) and where it
  ended (your last kept trial);
- the held-out window's change;
- what is close now;
- what is out of reach, and why.

## 2. Scores

Use the table from `sh repro/match.sh <world> --log`, cut down to the base,
each kept trial and the final holdout run:

| Trial | Kept | Note | Mean shape | Mean look | Worst window (look) |
| --- | --- | --- | ---: | ---: | --- |

Then quote the log's last line, the count of trials per kind of lever.

## 3. Kept changes

One entry per commit, world changes first, then each window's map changes
(`map:` commits) and shape changes (`fixture:` commits):

- the commit;
- the setting or file: the key path, the value before and after;
- why, naming the finding it aimed at;
- the trial id;
- the score change for each window.

## 4. By eye

For each window:

- what now reads as retail at 1x;
- what still does not;
- the crop or pair path for each claim.

## 5. Tried and dropped

Each lever tried and not kept: the trial ids, the values, and why
(scores, eye, or both). Include the controls that moved nothing. They are
evidence for section 6.

## 6. Proposals

One block per gap the world data could not close, largest first. Use
exactly these fields:

```
### <short name>
- Window and class: <window(s)>, <class>   (finding key, e.g. green-5 steep:lines)
- Retail shows: <what, at 1x, with the crop path>
- Ours shows: <what, with the crop path>
- Measured gap: <metric: retail X, ours Y, trial id>
- Levers tried: <key=value (trial id, effect)>, ...   (every one, from the log; for a texture
  or color gap, at least one material and one surface layer try; for a gap only some windows
  have, the map lane)
- Closest result: <trial id and why it is still wrong>
- Stage: <height | light | placement | predither | dither, from stages-NNN/stages.md, with its trust>
- Oracle: <oracle-NNN: the patch in one line, the gap before and after, the crop path; or why no shader
  change can test it>
- Missing piece: one of: new fact | new material node | wider control range |
  new effect | new tool or preset | stroke option | engine change
- Recommendation: <what to build, in one or two sentences, generic for every world>
- Would also help: <other worlds or windows that show the same thing, if known>
```

A proposal names a generic capability, not a world-specific hack. Every
world runs the same engine (AGENTS.md rule 7).

## 7. Map and fixture notes

For each window: the map choices it ended with (rock types, ground, steps,
ground relief) and why that retail map wants them, so a reviewer can port
them as tool presets or rock types. Then windows whose strokes do not
follow the retail heights: what is off (cite `layout.png`), and whether you
fixed it (the `fixture:` commit) or left it.

## 8. Not done

What you meant to try and did not, and why.
